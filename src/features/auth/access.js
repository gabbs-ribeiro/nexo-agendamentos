import { supabase } from '../../lib/supabase.js'
import { ApiError } from '../../lib/errors.js'

export async function getAdminBusinesses(userId) {
  const { data: memberships, error: membershipError } = await supabase
    .from('business_members')
    .select('business_id, role')
    .eq('user_id', userId)

  if (membershipError || !Array.isArray(memberships)) throw new ApiError('AUTH_CHECK_FAILED')
  const ownerMemberships = memberships.filter((membership) => membership.role === 'owner')
  if (ownerMemberships.length === 0) return []

  const businessIds = ownerMemberships.map((membership) => membership.business_id)
  const { data: businesses, error: businessError } = await supabase
    .from('businesses')
    .select('id, name, slug, logo_path, primary_color, timezone')
    .in('id', businessIds)

  if (businessError || !Array.isArray(businesses)) throw new ApiError('AUTH_CHECK_FAILED')
  return businesses
}
