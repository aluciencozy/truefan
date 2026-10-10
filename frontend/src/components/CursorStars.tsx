export default function CursorStars() {
  return <div className="cursor-stars" aria-hidden="true">
    {Array.from({ length: 10 }, (_, index) => <i key={index} />)}
  </div>
}
