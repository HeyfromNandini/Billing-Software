export default function CompanyBlock({ company }) {
  if (!company) return null
  const phones = [company.phone_1, company.phone_2].filter(Boolean).join(' / ')
  return (
    <div className="block company-block">
      <h2 className="company-name">{company.company_name}</h2>
      <p className="company-address">{company.address}</p>
      <p className="company-meta">
        {company.pan_number && <><span>PAN:</span> {company.pan_number}</>}
        {phones && <> &nbsp; <span>Mobile:</span> {phones}</>}
      </p>
    </div>
  )
}
