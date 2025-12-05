const cron = require('node-cron');

function startSchedulers({ client, db, helpers }) {
  // Weekly tokens reset: Monday 00:00
  (async () => {
    const tz = (await db.getConfig(db._db, 'timezone')) || 'Europe/Rome';
    cron.schedule('0 0 * * 1', async () => {
      try {
        await db.resetAllTokens(db._db);
        const logChId = await db.getConfig(db._db, 'log_channel_id');
        if (logChId) {
          const ch = await client.channels.fetch(logChId).catch(() => null);
          ch?.send('Weekly token reset completed.');
        }
      } catch (e) { console.error('Weekly reset error', e); }
    }, { timezone: tz });

    // Hourly: handle TTL expirations and hold confirmations
    cron.schedule('0 * * * *', async () => {
      try {
        const holdDays = parseInt((await db.getConfig(db._db, 'confirm_hold_days')) || '7', 10);
        const ttlDays = parseInt((await db.getConfig(db._db, 'pending_ttl_days')) || '7', 10);

        const now = Math.floor(Date.now() / 1000);
        const pending = await db.getPendingHolding(db._db);

        for (const ref of pending) {
          const preferGuildId = process.env.GUILD_ID || null;
          const guild = preferGuildId ? client.guilds.cache.get(preferGuildId) : client.guilds.cache.first();
          if (!guild) continue;

          // Expire pending
          if (ref.status === 'pending' && ref.expires_at && ref.expires_at < now) {
            await db.failReferral(db._db, ref.invitee_id, 'expired');
            await db.addTokens(db._db, ref.inviter_id, +1);
            
            // Remove only the invited role when referral expires after TTL
            // Keep the optional waiting role (if any)
            try {
              const member = await guild.members.fetch(ref.invitee_id);
              const invitedRoleId = (await db.getConfig(db._db, 'invited_role_id')) || process.env.INVITED_ROLE_ID;
              if (invitedRoleId && member.roles.cache.has(invitedRoleId)) {
                await member.roles.remove(invitedRoleId, 'Referral expired, removing invited role');
              }
            } catch (e) {
              // Ignore errors if user not found
            }
            
            await helpers.notifyInviter(ref.inviter_id, `Referral for <@${ref.invitee_id}> expired; token refunded and invited role removed.`);
            continue;
          }

          // Confirm holding if hold elapsed and role still present
          if (ref.status === 'holding' && ref.confirm_started_at && (ref.confirm_started_at + holdDays * 86400) <= now) {
            try {
              const member = await guild.members.fetch(ref.invitee_id);
              const roleId = (await db.getConfig(db._db, 'required_role_id')) || process.env.REQUIRED_ROLE_ID;
              if (roleId && member.roles.cache.has(roleId)) {
                await db.confirmReferral(db._db, ref.invitee_id);
                await helpers.onReferralConfirmed(ref.inviter_id, ref.invitee_id);
              } else {
                await db.failReferral(db._db, ref.invitee_id, 'role_lost');
                await db.addTokens(db._db, ref.inviter_id, +1);
                await helpers.notifyInviter(ref.inviter_id, `Referral for <@${ref.invitee_id}> did not keep the required role; token refunded.`);
              }
            } catch {
              // If cannot fetch member (left), mark failed
              await db.failReferral(db._db, ref.invitee_id, 'left');
              await db.addTokens(db._db, ref.inviter_id, +1);
              await helpers.notifyInviter(ref.inviter_id, `Referral for <@${ref.invitee_id}> left the server; token refunded.`);
            }
          }
        }
      } catch (e) { console.error('Hourly job error', e); }
    }, { timezone: tz });
  })();
}

module.exports = { startSchedulers };
