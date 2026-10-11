import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route } from 'react-router-dom'
import App from './App'
import AuthProvider from './components/AuthProvider'
import AuthPages from './components/AuthPages'
import HomePage from './components/HomePage'
import CommunityPage from './components/CommunityPage'
import LibraryPage from './components/LibraryPage'
import CursorStars from './components/CursorStars'
import PageTransition from './components/PageTransition'
import OpeningAnimation from './components/OpeningAnimation'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><AuthProvider><OpeningAnimation><CursorStars /><PageTransition>
    <Route path="/" element={<HomePage />} />
    <Route path="/explore" element={<App />} />
    <Route path="/community" element={<CommunityPage />} />
    <Route path="/library" element={<LibraryPage />} />
    <Route path="/auth/:path" element={<AuthPages />} />
    <Route path="/account/:path" element={<AuthPages account />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </PageTransition></OpeningAnimation></AuthProvider></BrowserRouter></StrictMode>,
)
