require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Events, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('./db');
const { InviteCache } = require('./inviteCache');
const { startSchedulers } = require('./scheduler');
const referralCmd = require('./commands/referral');
const adminCmd = require('./commands/admin');
const staffCmd = require('./commands/staff');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
  ],
  partials: [Partials.GuildMember],
});

const _db = db.open();

const inviteCache = new InviteCache();

const helpers = {
  async notifyInviter(inviterId, message) {
    try {
      const user = await client.users.fetch(inviterId);
      await user.send(message);
    } catch {}
  },
  async log(message) {
    const logChId = (await db.getConfig(_db, 'log_channel_id')) || process.env.LOG_CHANNEL_ID;
    if (!logChId) return;
    const ch = await client.channels.fetch(logChId).catch(() => null);
    ch?.send(message);
  },
  async onReferralConfirmed(inviterId, inviteeId) {
    await helpers.notifyInviter(inviterId, `Referral confirmed: <@${inviteeId}>! 🎉`);
    const count = await db.getConfirmedCount(_db, inviterId);
    const rawT1 = (await db.getConfig(_db, 'reward_tier1')) || process.env.REWARD_TIER1 || '5';
    const rawT2 = (await db.getConfig(_db, 'reward_tier2')) || process.env.REWARD_TIER2 || '15';
    const t1 = parseInt(rawT1, 10);
    const t2 = parseInt(rawT2, 10);
    const rewardChId = (await db.getConfig(_db, 'reward_channel_id')) || process.env.REWARD_CHANNEL_ID || (await db.getConfig(_db, 'invite_channel_id')) || process.env.INVITE_CHANNEL_ID;
    const staffRoleId = (await db.getConfig(_db, 'staff_role_id')) || process.env.STAFF_ROLE_ID;
    if ((count === t1 || count === t2) && !(await db.hasReward(_db, inviterId, count))) {
      await db.markReward(_db, inviterId, count);
      const staffTag = staffRoleId ? ` <@&${staffRoleId}>` : '';
      const msg = `🎁 <@${inviterId}> congrats! You reached ${count} confirmed referrals!${staffTag}`;
      if (rewardChId) {
        const ch = await client.channels.fetch(rewardChId).catch(() => null);
        ch?.send(msg);
      } else {
        await helpers.log(msg);
      }
    }
    await upsertLeaderboardMessage();
  },
};

async function buildLeaderboardEmbed() {
  const top = await db.getLeaderboard(_db, 'all');
  const top5 = top.slice(0, 5);
  const medals = ['🥇', '🥈', '🥉'];
  const nums = ['4️⃣', '5️⃣'];
  const lines = top5.map((r, i) => {
    const prefix = i < 3 ? medals[i] : nums[i - 3] || '•';
    return `${prefix} <@${r.inviter_id}> — ${r.confirmed}`;
  });
  const description = lines.length ? lines.join('\n') : 'No data yet. Invite users and complete confirmations!';
  return new EmbedBuilder()
    .setTitle('🏆 Referral Leaderboard — Top 5')
    .setDescription(description)
    .setColor(0xF1C40F)
    .setFooter({ text: 'Conteggio: referral confermati (all‑time)' })
    .setTimestamp(new Date());
}

async function upsertLeaderboardMessage() {
  try {
    const channelId = (await db.getConfig(_db, 'leaderboard_channel_id')) || process.env.LEADERBOARD_CHANNEL_ID || (await db.getConfig(_db, 'invite_channel_id')) || process.env.INVITE_CHANNEL_ID;
    if (!channelId) return;
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch || !('send' in ch)) return;

    const embed = await buildLeaderboardEmbed();
    const msgId = await db.getConfig(_db, 'leaderboard_message_id');
    if (msgId) {
      const msg = await ch.messages.fetch(msgId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed] }).catch(() => null);
        return;
      }
    }
    const sent = await ch.send({ embeds: [embed] }).catch(() => null);
    if (sent?.id) await db.setConfig(_db, 'leaderboard_message_id', sent.id);
  } catch (e) { console.warn('Leaderboard upsert error', e.message); }
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await db.ensureDefaultConfig(_db);
  // Seed invite cache for all guilds (single guild expected)
  for (const [gid, guild] of client.guilds.cache) {
    try {
      const invites = await guild.invites.fetch();
      inviteCache.seed(gid, invites);
    } catch (e) { console.warn('Cannot fetch invites for guild', gid, e.message); }
  }
  startSchedulers({ client, db: { ...db, _db }, helpers });
  await upsertLeaderboardMessage();
});

client.on(Events.InviteCreate, async (invite) => {
  // Update only the cache; counted invites are those created via /referral link (already stored in DB)
  inviteCache.updateOnCreate(invite.guild.id, invite);
});

client.on(Events.InviteDelete, (invite) => {
  inviteCache.updateOnDelete(invite.guild.id, invite.code);
  db.setInviteActive(_db, invite.code, 0);
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const guild = member.guild;
    const fresh = await guild.invites.fetch();
    const usedInvite = inviteCache.detectUsedInvite(guild.id, fresh);

    if (!usedInvite) {
      await helpers.log(`Join non attribuibile: ${member.user.tag} (${member.id})`);
      return;
    }

    const code = usedInvite.code;
    const rec = await db.getInviteByCode(_db, code);
    if (!rec || !rec.inviter_id) return; // not one of our invites

    const joinedAt = Math.floor(Date.now() / 1000);

    // Enforce minimum account age: if under threshold, do NOT count or consume tokens
    const minAge = parseInt((await db.getConfig(_db, 'min_account_age_days')) || '30', 10);
    const createdAt = Math.floor(member.user.createdTimestamp / 1000);
    const ageDays = (joinedAt - createdAt) / 86400;
    if (ageDays < minAge) {
      await helpers.notifyInviter(rec.inviter_id, `A new user (<@${member.id}>) used your link but their account is too new (${Math.floor(ageDays)} days). They will not be counted.`);
      await helpers.log(`Under-age join not counted: ${member.user.tag} (${member.id}), inviter ${rec.inviter_id}`);
      return;
    }

    // If inviter has no tokens, do not credit but keep invite active
    const tokens = await db.getTokens(_db, rec.inviter_id);
    if (tokens <= 0) {
      await helpers.notifyInviter(rec.inviter_id, `A user joined with your link but you had no tokens: <@${member.id}> will not be counted (link stays active).`);
      return;
    }

    // Create pending referral and then consume a token
    const ttl = parseInt((await db.getConfig(_db, 'pending_ttl_days')) || '7', 10);
    const expiresAt = ttl > 0 ? joinedAt + ttl * 86400 : null;
    await db.createReferralPending(_db, {
      inviterId: rec.inviter_id,
      inviteCode: code,
      inviteeId: member.id,
      joinedAt,
      expiresAt,
      suspicious: false,
    });
    await db.consumeToken(_db, rec.inviter_id);

    // Assign both roles on join: Waiting role + Invited role
    const entryRoleId = (await db.getConfig(_db, 'entry_role_id')) || process.env.ENTRY_ROLE_ID; // optional waiting role
    const invitedRoleId = (await db.getConfig(_db, 'invited_role_id')) || process.env.INVITED_ROLE_ID; // optional invited role
    
    if (entryRoleId) {
      try { await member.roles.add(entryRoleId, 'Entry role on referral join'); } catch {}
    }
    if (invitedRoleId) {
      try { await member.roles.add(invitedRoleId, 'Invited role on referral join'); } catch {}
    }
    const tLeft = await db.getTokens(_db, rec.inviter_id);
    await helpers.notifyInviter(rec.inviter_id, `New pending referral: <@${member.id}>. Tokens left: ${tLeft}`);
    await helpers.log(`Pending referral created: inviter <@${rec.inviter_id}> → invitee <@${member.id}> via code ${code}`);
  } catch (e) {
    console.error('GuildMemberAdd error', e);
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  try {
    const roleId = (await db.getConfig(_db, 'required_role_id')) || process.env.REQUIRED_ROLE_ID;
    if (!roleId) return;
    // Detect role added
    const had = oldMember?.roles?.cache?.has(roleId) ?? false;
    const has = newMember.roles.cache.has(roleId);
    if (!had && has) {
      const pending = await db.getPendingByInvitee(_db, newMember.id);
      if (!pending) return;
      await db.startHold(_db, newMember.id);
      const holdDays = parseInt((await db.getConfig(_db, 'confirm_hold_days')) || '7', 10);
      await helpers.notifyInviter(pending.inviter_id, `Referral <@${newMember.id}> obtained the required role. Waiting ${holdDays} days...`);
    }
  } catch (e) {
    console.error('GuildMemberUpdate error', e);
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  try {
    const pending = await db.getPendingByInvitee(_db, member.id);
    if (!pending) return;
    await db.failReferral(_db, member.id, 'left');
    await db.addTokens(_db, pending.inviter_id, +1);
    await helpers.notifyInviter(pending.inviter_id, `Referral <@${member.id}> left the server; token refunded.`);
  } catch (e) {
    console.error('GuildMemberRemove error', e);
  }
});

// Interaction handler
const dbCtx = { ...db, _db };
const handlers = [
  referralCmd.handlerFactory({ db: dbCtx }),
  adminCmd.handlerFactory({ db: dbCtx }),
  staffCmd.handlerFactory({ db: dbCtx, client }),
];
client.on(Events.InteractionCreate, async (interaction) => {
  for (const h of handlers) {
    await h.handle(interaction);
  }
});

client.login(process.env.DISCORD_TOKEN);

// Export functions for use in other modules
module.exports = {
  upsertLeaderboardMessage,
};
