/**
 * Métricas de red desde sponsor_id (fuente de verdad; los contadores en users pueden desincronizarse).
 */

export async function countDirectReferrals(client, userId) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS c FROM users WHERE sponsor_id = $1::uuid`,
    [userId]
  );
  return Number(r.rows[0]?.c ?? 0);
}

export async function countNetworkDownline(client, userId) {
  const r = await client.query(
    `WITH RECURSIVE descendants AS (
       SELECT id FROM users WHERE sponsor_id = $1::uuid
       UNION ALL
       SELECT x.id FROM users x
       INNER JOIN descendants d ON x.sponsor_id = d.id
     )
     SELECT COUNT(*)::int AS c FROM descendants`,
    [userId]
  );
  return Number(r.rows[0]?.c ?? 0);
}
