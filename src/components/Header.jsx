import { Link, useParams } from 'react-router-dom'

const APP_NAME = 'Deva lifters'

export default function Header({ companyName, backTo }) {
  const { companyId: routeCompanyId } = useParams()
  return (
    <header className="header">
      <button type="button" className="menu-btn" aria-label="Open menu">
        <span /><span /><span />
      </button>
      {backTo ? (
        <Link to={backTo} className="header-back">← Back</Link>
      ) : null}
      <h1 className="logo">
        {companyName ? (
          companyName
        ) : (
          <Link to="/" className="logo-link" title="Home">{APP_NAME}</Link>
        )}
      </h1>
      <nav className="nav nav-companies">
        <Link
          to="/company/aadarsh"
          className={routeCompanyId === 'aadarsh' ? 'nav-link active' : 'nav-link'}
        >
          Aadarsh Logistics
        </Link>
        <Link
          to="/company/deva"
          className={routeCompanyId === 'deva' ? 'nav-link active' : 'nav-link'}
        >
          Deva Lifters
        </Link>
        <Link
          to="/company/sangita"
          className={routeCompanyId === 'sangita' ? 'nav-link active' : 'nav-link'}
        >
          Sangita Logistics
        </Link>
      </nav>
    </header>
  )
}
