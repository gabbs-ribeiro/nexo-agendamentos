import { createContext, useContext } from 'react'

const AdminBusinessContext = createContext(null)

export function AdminBusinessProvider({ business, children }) {
  return (
    <AdminBusinessContext.Provider value={business}>
      {children}
    </AdminBusinessContext.Provider>
  )
}

export function useAdminBusiness() {
  const business = useContext(AdminBusinessContext)
  if (!business) throw new Error('AdminBusinessProvider ausente.')
  return business
}
