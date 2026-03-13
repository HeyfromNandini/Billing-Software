import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppProvider } from './context/AppContext'
import Header from './components/Header'
import LandingPage from './pages/LandingPage'
import CompanyPage from './pages/CompanyPage'
import ClientBillsPage from './pages/ClientBillsPage'
import BillPage from './pages/BillPage'

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <div className="app-wrap">
                <Header />
                <main className="main main-landing">
                  <LandingPage />
                </main>
                <footer className="footer">
                  <p>Deva lifters – Billing software</p>
                </footer>
              </div>
            }
          />
          <Route
            path="/company/:companyId"
            element={
              <div className="app-wrap">
                <Header />
                <main className="main">
                  <CompanyPage />
                </main>
                <footer className="footer">
                  <p>Deva lifters – Billing software</p>
                </footer>
              </div>
            }
          />
          <Route
            path="/company/:companyId/client/:clientId"
            element={
              <div className="app-wrap">
                <Header />
                <main className="main">
                  <ClientBillsPage />
                </main>
                <footer className="footer">
                  <p>Deva lifters – Billing software</p>
                </footer>
              </div>
            }
          />
          <Route path="/company/:companyId/bill/:billId" element={<BillPage />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  )
}
