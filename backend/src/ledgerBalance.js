/**
 * Saldo disponible = comisiones (líneas no anuladas por mora) − desembolsos pagados.
 */

export async function computeAvailableBalanceCents(pool, userId) {
  let commissionSum = 0n;
  try {
    const c = await pool.query(
      `SELECT COALESCE(SUM(amount_cents),0)::bigint AS t FROM commission_lines
       WHERE recipient_id = $1::uuid AND (forfeited_at IS NULL)`,
      [userId]
    );
    commissionSum = BigInt(c.rows[0].t);
  } catch (e) {
    if (e.code === "42703") {
      const c = await pool.query(
        `SELECT COALESCE(SUM(amount_cents),0)::bigint AS t FROM commission_lines WHERE recipient_id = $1::uuid`,
        [userId]
      );
      commissionSum = BigInt(c.rows[0].t);
    } else throw e;
  }

  let paidOut = 0n;
  try {
    const p = await pool.query(
      `SELECT COALESCE(SUM(amount_cents),0)::bigint AS t FROM disbursement_payouts
       WHERE user_id = $1::uuid AND paid_at IS NOT NULL`,
      [userId]
    );
    paidOut = BigInt(p.rows[0].t);
  } catch (e) {
    if (e.code === "42P01") paidOut = 0n;
    else throw e;
  }

  const net = commissionSum - paidOut;
  return net < 0n ? 0n : net;
}
