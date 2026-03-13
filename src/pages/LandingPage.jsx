import { useNavigate } from 'react-router-dom'

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="landing">
      <div className="landing-hero">
        <h1 className="landing-title">Welcome to your billing software</h1>
        <div className="landing-cta">
          <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate('/company/sangita')}>
            Start billing
          </button>
        </div>
      </div>
    </div>
  )
}
