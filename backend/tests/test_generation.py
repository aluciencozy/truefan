import asyncio
import copy
import json
import unittest
from unittest.mock import patch
from app.schemas import RevealPoint, CurrentUser, Media, GenerationStatus
from app.services import generation, huggingface, episodes
from app.services.graph import filter_graph
from app.main import app
from app.auth import current_user


def source(unit=1):
    return episodes.Episode(unit=unit,number=unit,title='Episode',description='Ada rescues Ben. They walk together after the rescue.',provider='kitsu',source_url='https://kitsu.app/episode/1',provider_id='1')

def extraction():
    return {'characters':[{'name':n,'aliases':[],'description':'Participates in a rescue.','evidence':'Ada rescues Ben.'} for n in ['Ada','Ben']],
            'relationships':[{'source':'Ada','target':'Ben','type':'rescues','label':'Rescues Ben','evidence':'Ada rescues Ben.'}]}

async def request(path, method='GET', body=None):
    messages=[]; sent=False
    async def receive():
        nonlocal sent
        if sent: return {'type':'http.disconnect'}
        sent=True
        return {'type':'http.request','body':json.dumps(body).encode() if body else b'', 'more_body':False}
    async def send(message): messages.append(message)
    path, _, query=path.partition('?')
    await app({'type':'http','asgi':{'version':'3.0'},'http_version':'1.1','method':method,'path':path,
               'raw_path':path.encode(),'query_string':query.encode(),'headers':[(b'content-type',b'application/json')],
               'scheme':'http','server':('test',80),'client':('test',1),'root_path':''},receive,send)
    return messages[0]['status'],json.loads(b''.join(m.get('body',b'') for m in messages[1:]))

class ExtractionTests(unittest.TestCase):
    def test_source_grounding_and_passive_direction(self):
        data=extraction(); self.assertEqual(len(huggingface.parse(json.dumps(data),source().description).relationships),1)
        data['relationships'][0].update(source='Ben',target='Ada',evidence='Ben was saved by Ada.')
        self.assertEqual(huggingface.parse(json.dumps(data),source().description+' Ben was saved by Ada.').relationships,[])
        data=extraction(); data['relationships'][0]['type']='truce'
        self.assertEqual(huggingface.parse(json.dumps(data),source().description).relationships,[])
    def test_invalid_json_dangling_and_fabricated_evidence(self):
        with self.assertRaises(ValueError): huggingface.parse('{bad',source().description)
        data=extraction(); data['characters'][1]['name']='female student'; data['relationships'][0]['target']='Beth'
        self.assertEqual(huggingface.parse(json.dumps(data),source().description).relationships,[])
        data=extraction(); data['relationships'][0]['evidence']='They are siblings.'
        self.assertEqual(huggingface.parse(json.dumps(data),source().description).relationships,[])
    def test_bad_record_does_not_discard_good_characters(self):
        data=extraction(); data['relationships'][0]['label']='too many words for the required short label'
        parsed=huggingface.parse(json.dumps(data),source().description)
        self.assertEqual(len(parsed.characters),2);self.assertEqual(parsed.relationships,[]);self.assertTrue(parsed._issues)
    def test_explicit_endpoint_creates_minimal_grounded_node(self):
        data=extraction();data['characters']=data['characters'][:1]
        parsed=huggingface.parse(json.dumps(data),source().description)
        self.assertEqual({c.name for c in parsed.characters},{'Ada','Ben'});self.assertEqual(len(parsed.relationships),1)
    def test_configurable_inference_and_no_paid_retries(self):
        with patch('app.services.huggingface.fetch',return_value={'choices':[{'finish_reason':'stop','message':{'content':json.dumps(extraction())}}]}) as fetch:
            huggingface.extract_episode(source(),model='custom/model:provider')
            self.assertEqual(fetch.call_args.args[1]['model'],'custom/model:provider'); self.assertEqual(fetch.call_args.kwargs['retries'],0)

class ProviderTests(unittest.TestCase):
    def test_normalize_prologue_offset_missing_and_duplicates(self):
        rows=[{'id':'a','attributes':{'number':1,'description':None}},{'id':'b','attributes':{'number':2,'description':'<p>Ada &amp; Ben</p>'}}]
        result=episodes.normalize(rows,2,prologue=True)
        self.assertEqual([r.unit for r in result],[2,3]); self.assertIsNone(result[0].description)
        self.assertEqual(result[1].description,'Ada & Ben')
        with self.assertRaises(ValueError): episodes.normalize(rows+[rows[0]],3)
    def test_no_unverified_tvmaze_title_match(self):
        with patch('app.services.episodes.fetch') as fetch:
            self.assertEqual(episodes.tvmaze_episodes({}),[]); fetch.assert_not_called()
    def test_provider_failure_is_not_missing_data(self):
        with patch('app.services.episodes.fetch',side_effect=ValueError('network')):
            with self.assertRaises(ValueError): episodes.pages(episodes.KITSU+'/anime')
    def test_ubw_fallback_and_chronological_units(self):
        with patch('app.services.episodes.resolve_kitsu',return_value=('7882',{})),patch('app.services.episodes.mapping',return_value={'myanimelist/anime':'27821'}),patch('app.services.episodes.pages',side_effect=[
            [{'id':'e1','attributes':{'number':1,'description':'A numbered description.'}}],
            [{'id':'p','attributes':{'number':1,'description':None}}]]),patch('app.services.episodes.tvmaze_episodes',return_value=[
                {'number':None,'name':'Fate/Stay Night: Unlimited Blade Works - Prologue','summary':'<p>A prologue description.</p>','id':99}]):
            result=episodes.get_episodes({'id':19603},2)
            self.assertEqual([(e.unit,e.number) for e in result],[(1,0),(2,1)]); self.assertEqual(result[0].provider,'tvmaze')

class GraphTests(unittest.TestCase):
    def document(self):
        one={'episode':source().model_dump(exclude={'description'}),'status':'done','model':'m',**extraction()}
        later=copy.deepcopy(one); later['episode']['unit']=3; later['characters'][0]['description']='A later revelation.'
        return {'episodes':[one,later]}
    def test_dedup_and_latest_visible_description(self):
        entities,edges=generation.graph_data(self.document());self.assertEqual(len(edges),1)
        early=filter_graph('media',RevealPoint(unit=1),entities,edges);late=filter_graph('media',RevealPoint(unit=3),entities,edges)
        self.assertEqual(len(early.entities),2); self.assertNotIn('A later revelation.',[n.description for n in early.entities])
        self.assertIn('A later revelation.',[n.description for n in late.entities]);self.assertEqual(filter_graph('media',RevealPoint(unit=0),entities,edges).entities,[])
    def test_unambiguous_short_alias(self):
        doc=self.document();doc['episodes'][0]['characters'][0]['name']='Ada Smith';doc['episodes'][0]['relationships'][0]['source']='Ada Smith'
        nodes,_=generation.graph_data(doc); self.assertEqual(nodes[0].id,nodes[2].id)

class JobTests(unittest.TestCase):
    def test_partial_failure_checkpoint_and_retry_skips_success(self):
        row={'media_id':'anilist-1','working_document':{'episodes':[]},'model':'model','episode_cap':2,'lease_token':'t','regenerating':False}
        entry={'id':1,'title':{'english':'Title','romaji':'Title'},'episodes':3,'format':'TV'}
        with patch('app.services.generation.anilist.details',return_value=entry),patch('app.services.generation.episodes.get_episodes',return_value=[source(1),source(2)]),patch('app.services.generation.huggingface.extract_episode',side_effect=[huggingface.Extraction.model_validate(extraction()),ValueError('malformed')]) as infer,patch('app.services.generation.checkpoint',return_value=True) as checkpoint:
            generation.run(row);self.assertEqual(checkpoint.call_args.args[2],'partial'); self.assertEqual(row['working_document']['episodes'][1]['status'],'failed')
            infer.side_effect=None;infer.return_value=huggingface.Extraction.model_validate(extraction());infer.reset_mock();generation.run(row);self.assertEqual(infer.call_count,1)
    def test_lost_lease_stops_additional_inference(self):
        row={'media_id':'anilist-1','working_document':{'episodes':[]},'model':'model','episode_cap':2,'lease_token':'t','regenerating':False}
        with patch('app.services.generation.anilist.details',return_value={}),patch('app.services.generation.episodes.get_episodes',return_value=[source(1),source(2)]),patch('app.services.generation.huggingface.extract_episode',return_value=huggingface.Extraction.model_validate(extraction())) as infer,patch('app.services.generation.checkpoint',return_value=False):
            generation.run(row);self.assertEqual(infer.call_count,0)

class ApiTests(unittest.TestCase):
    def tearDown(self): app.dependency_overrides.clear()
    def test_missing_graph_is_read_only(self):
        with patch('app.main.get_media',return_value=Media(id='anilist-1',title='Title',type='anime',progress_unit='episode',total_units=3,description='')),patch('app.main.cached_generation',return_value=None),patch('app.services.generation.enqueue') as enqueue:
            code,data=asyncio.run(request('/api/media/anilist-1/graph?progress=1'))
            self.assertEqual(code,200);self.assertTrue(data['experimental']);self.assertEqual(data['generation']['status'],'not_generated');enqueue.assert_not_called()
    def test_costly_endpoint_requires_authentication(self):
        code,_=asyncio.run(request('/api/media/anilist-1/generation','POST',{'operation':'start'}));self.assertEqual(code,401)
    def test_generation_uses_verified_user(self):
        app.dependency_overrides[current_user]=lambda: CurrentUser(id='verified-user')
        with patch('app.main.get_media'),patch('app.services.generation.enqueue',return_value={}) as enqueue,patch('app.services.generation.status',return_value=GenerationStatus(status='queued')):
            code,data=asyncio.run(request('/api/media/anilist-1/generation','POST',{'operation':'start'}))
            self.assertEqual(code,202);self.assertEqual(data['status'],'queued');self.assertEqual(enqueue.call_args.args,('anilist-1','verified-user','start'))
