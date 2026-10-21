import { supabase } from '../../lib/supabase.js'
import { ApiError } from '../../lib/errors.js'

export async function getAdminBusinesses(userId) {
  const { data, error } = await supabase
    .from('business_members')
    .select('business_id, role')
    .eq('user_id', userId)

  if (error || !Array.isArray(data)) throw new ApiError('AUTH_CHECK_FAILED')
  return data.filter((membership) => membership.role === 'owner')
}
