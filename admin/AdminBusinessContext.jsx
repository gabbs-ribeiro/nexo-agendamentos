import { createContext, useContext } from 'react'

const AdminBusinessContext = createContext(null)
const AdminBusinessActionsContext = createContext(null)

export function AdminBusinessProvider({ business, onBusinessChange, children }) {
  return (
    <AdminBusinessActionsContext.Provider value={onBusinessChange}>
      <AdminBusinessContext.Provider value={business}>
        {children}
      </AdminBusinessContext.Provider>
    </AdminBusinessActionsContext.Provider>
  )
}

export function useAdminBusiness() {
  const business = useContext(AdminBusinessContext)
  if (!business) throw new Error('AdminBusinessProvider ausente.')
  return business
}

export function useUpdateAdminBusiness() {
  const updateBusiness = useContext(AdminBusinessActionsContext)
  if (!updateBusiness) throw new Error('AdminBusinessProvider ausente.')
  return updateBusiness
}
