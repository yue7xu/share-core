import { rpc } from './supabase';

export { minutes, clock, costLine } from './format';

export async function getCard(id) {
  if (!/^[a-f0-9]{8,40}$/.test(id)) return null;
  try {
    return await rpc('get_card', { p_id: id });
  } catch {
    return null;
  }
}
