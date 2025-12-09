const { MessageFlags } = require('discord.js');

function definitions() {
  return [
    {
      name: 'staff',
      description: 'Staff tools for referral validation',
      dm_permission: false,
      options: [
        {
          type: 1,
          name: 'validate',
          description: 'Assign the validation role to the invited member',
          options: [
            { type: 6, name: 'user', description: 'User to validate', required: true },
          ],
        },
        {
          type: 1,
          name: 'who-invited',
          description: 'Show who invited a user',
          options: [
            { type: 6, name: 'user', description: 'User to check', required: true },
          ],
        },
        {
          type: 1,
          name: 'invited',
          description: 'List users invited by someone',
          options: [
            { type: 6, name: 'user', description: 'Inviter to inspect', required: true },
            { type: 3, name: 'status', description: 'Status filter', required: false, choices: [
              { name: 'all', value: 'all' },
              { name: 'pending', value: 'pending' },
              { name: 'holding', value: 'holding' },
              { name: 'confirmed', value: 'confirmed' },
              { name: 'failed', value: 'failed' },
            ] },
            { type: 4, name: 'limit', description: 'Max number (1-50)', required: false },
          ],
        },
        {
          type: 1,
          name: 'process-referrals',
          description: 'Process pending/holding immediately (testing/manual)',
          options: [
            { type: 5, name: 'force_confirm', description: 'Confirm holding while ignoring hold time', required: false },
          ],
        },
        {
          type: 1,
          name: 'check-confirmations',
          description: 'Check and confirm referrals that kept the role through the hold',
          options: [],
        },
        {
          type: 1,
          name: 'check-pending',
          description: 'Show remaining days before automatic confirmation for holding referrals',
          options: [],
        },
      ],
    },
  ];
}

function handlerFactory({ db, client, helpers }) {
  return {
    async handle(interaction) {
      if (!interaction.isChatInputCommand() || interaction.commandName !== 'staff') return;
      const sub = interaction.options.getSubcommand();
      if (sub === 'validate') return validate(interaction, db);
      if (sub === 'who-invited') return whoInvited(interaction, db);
      if (sub === 'invited') return invitedList(interaction, db);
      if (sub === 'process-referrals') return processNow(interaction, db, client, helpers);
      if (sub === 'check-confirmations') return checkConfirmations(interaction, db, client);
      if (sub === 'check-pending') return checkPending(interaction, db);
    },
  };
}

async function validate(interaction, db) {
  const staffRoleId = (await db.getConfig(db._db, 'staff_role_id')) || process.env.STAFF_ROLE_ID;
  const requiredRoleId = (await db.getConfig(db._db, 'required_role_id')) || process.env.REQUIRED_ROLE_ID;
  if (!requiredRoleId) return interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Validation role not configured.' });
  const member = interaction.member;
  if (staffRoleId && !member.roles.cache.has(staffRoleId)) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Only staff can use this command.' });
  }
  const target = interaction.options.getUser('user', true);
  const guildMember = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (!guildMember) return interaction.reply({ flags: MessageFlags.Ephemeral, content: 'User not found in the server.' });
  // Defer to avoid interaction timeout if role operations take >3s
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await guildMember.roles.add(requiredRoleId, 'Staff validation');
    // Remove optional role on validate if configured
    const removeRoleId = (await db.getConfig(db._db, 'remove_on_validate_role_id')) || process.env.REMOVE_ON_VALIDATE_ROLE_ID;
    if (removeRoleId) {
      try { await guildMember.roles.remove(removeRoleId, 'Remove role at validation time'); } catch {}
    }
    await interaction.editReply({ content: `Validation role assigned to ${guildMember}.` });
  } catch (e) {
    try {
      await interaction.editReply({ content: 'Unable to assign the role. Check bot permissions and role order.' });
    } catch {}
  }
}

async function whoInvited(interaction, db) {
  const staffRoleId = (await db.getConfig(db._db, 'staff_role_id')) || process.env.STAFF_ROLE_ID;
  const member = interaction.member;
  if (staffRoleId && !member.roles.cache.has(staffRoleId)) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Only staff can use this command.' });
  }
  const target = interaction.options.getUser('user', true);
  const ref = await db.getLatestReferralByInvitee(db._db, target.id);
  if (!ref) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: 'No referral registered for this user (likely they did not use a bot invite).' });
  }
  const tz = (await db.getConfig(db._db, 'timezone')) || 'Europe/Rome';
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' });
  const lines = [
    `User: <@${ref.invitee_id}>`,
    `Invited by: <@${ref.inviter_id}>`,
    `Status: ${ref.status}`,
    `Invite code: ${ref.invite_code || '-'}`,
    `Joined: ${ref.joined_at ? fmt.format(new Date(ref.joined_at * 1000)) : '-'}`,
  ];
  if (ref.status === 'holding' && ref.confirm_started_at) {
    lines.push(`Holding since: ${fmt.format(new Date(ref.confirm_started_at * 1000))}`);
  }
  if (ref.status === 'confirmed' && ref.confirmed_at) {
    lines.push(`Confirmed on: ${fmt.format(new Date(ref.confirmed_at * 1000))}`);
  }
  if (ref.status === 'pending' && ref.expires_at) {
    lines.push(`Pending expiry: ${fmt.format(new Date(ref.expires_at * 1000))}`);
  }
  if (ref.failure_reason) {
    lines.push(`Failure reason: ${ref.failure_reason}`);
  }
  return interaction.reply({ flags: MessageFlags.Ephemeral, content: lines.join('\n') });
}

async function invitedList(interaction, db) {
  const staffRoleId = (await db.getConfig(db._db, 'staff_role_id')) || process.env.STAFF_ROLE_ID;
  const member = interaction.member;
  if (staffRoleId && !member.roles.cache.has(staffRoleId)) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Only staff can use this command.' });
  }
  const inviter = interaction.options.getUser('user', true);
  const status = interaction.options.getString('status') || 'all';
  const limitOpt = interaction.options.getInteger('limit') || 20;
  const limit = Math.max(1, Math.min(50, limitOpt));
  const rows = await db.getReferralsByInviter(db._db, inviter.id, status, limit);
  if (!rows.length) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: 'No users found for the given filters.' });
  }
  const tz = (await db.getConfig(db._db, 'timezone')) || 'Europe/Rome';
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' });
  const header = `Invited by <@${inviter.id}> — status=${status} — max=${limit}`;
  const lines = rows.map(r => {
    let extra = '';
    if (r.status === 'confirmed' && r.confirmed_at) extra = `, confirmed: ${fmt.format(new Date(r.confirmed_at * 1000))}`;
    else if (r.status === 'holding' && r.confirm_started_at) extra = `, holding since: ${fmt.format(new Date(r.confirm_started_at * 1000))}`;
    else if (r.joined_at) extra = `, joined: ${fmt.format(new Date(r.joined_at * 1000))}`;
    return `• <@${r.invitee_id}> — ${r.status}${extra}`;
  });
  return interaction.reply({ flags: MessageFlags.Ephemeral, content: header + '\n' + lines.join('\n') });
}

async function processNow(interaction, db, client, helpers) {
  const staffRoleId = (await db.getConfig(db._db, 'staff_role_id')) || process.env.STAFF_ROLE_ID;
  if (staffRoleId && !interaction.member.roles.cache.has(staffRoleId)) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Only staff can use this command.' });
  }
  const force = interaction.options.getBoolean('force_confirm') || false;
  const holdDays = parseInt((await db.getConfig(db._db, 'confirm_hold_days')) || '7', 10);
  const now = Math.floor(Date.now() / 1000);
  const pending = await db.getPendingHolding(db._db);
  const preferGuildId = process.env.GUILD_ID || null;
  const guild = preferGuildId ? client.guilds.cache.get(preferGuildId) : client.guilds.cache.first();
  let expired = 0, confirmed = 0, refunded = 0, failed = 0;
  for (const ref of pending) {
    // expire pendings
    if (ref.status === 'pending' && ref.expires_at && ref.expires_at < now) {
      await db.failReferral(db._db, ref.invitee_id, 'expired');
      await db.addTokens(db._db, ref.inviter_id, +1); refunded++;
      
      // Remove only the invited role when a referral expires
      // Keep any waiting/entry role if configured
      try {
        const member = await guild.members.fetch(ref.invitee_id);
        const invitedRoleId = (await db.getConfig(db._db, 'invited_role_id')) || process.env.INVITED_ROLE_ID;
        if (invitedRoleId && member.roles.cache.has(invitedRoleId)) {
          await member.roles.remove(invitedRoleId, 'Referral expired, removing invited role');
        }
      } catch (e) {
        // Ignore errors if user not found
      }

      if (helpers?.notifyInviter) {
        await helpers.notifyInviter(ref.inviter_id, `Referral for <@${ref.invitee_id}> expired; token refunded and invited role removed.`);
      }

      expired++;
      continue;
    }
    // confirm holdings
    if (ref.status === 'holding' && (force || (ref.confirm_started_at && (ref.confirm_started_at + holdDays * 86400) <= now))) {
      try {
        const member = await guild.members.fetch(ref.invitee_id);
        const roleId = (await db.getConfig(db._db, 'required_role_id')) || process.env.REQUIRED_ROLE_ID;
        if (roleId && member.roles.cache.has(roleId)) {
          await db.confirmReferral(db._db, ref.invitee_id);
          if (helpers?.onReferralConfirmed) {
            await helpers.onReferralConfirmed(ref.inviter_id, ref.invitee_id);
          }
          confirmed++;
        } else {
          await db.failReferral(db._db, ref.invitee_id, 'role_lost');
          await db.addTokens(db._db, ref.inviter_id, +1); refunded++;
          if (helpers?.notifyInviter) {
            await helpers.notifyInviter(ref.inviter_id, `Referral for <@${ref.invitee_id}> did not keep the required role; token refunded.`);
          }
          failed++;
        }
      } catch {
        await db.failReferral(db._db, ref.invitee_id, 'left');
        await db.addTokens(db._db, ref.inviter_id, +1); refunded++;
        if (helpers?.notifyInviter) {
          await helpers.notifyInviter(ref.inviter_id, `Referral for <@${ref.invitee_id}> left the server; token refunded.`);
        }
        failed++;
      }
    }
  }
  const msg = `Processed: expired=${expired}, confirmed=${confirmed}, failed=${failed}, tokens refunded=${refunded}`;
  return interaction.reply({ flags: MessageFlags.Ephemeral, content: msg });
}

async function checkConfirmations(interaction, db, client) {
  const staffRoleId = (await db.getConfig(db._db, 'staff_role_id')) || process.env.STAFF_ROLE_ID;
  if (staffRoleId && !interaction.member.roles.cache.has(staffRoleId)) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Only staff can use this command.' });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const holdDays = parseInt((await db.getConfig(db._db, 'confirm_hold_days')) || '7', 10);
  const now = Math.floor(Date.now() / 1000);
  const holding = await db.getPendingHolding(db._db);
  
  // Filter only holding status referrals
  const holdingOnly = holding.filter(ref => ref.status === 'holding' && ref.confirm_started_at);
  
  const preferGuildId = process.env.GUILD_ID || null;
  const guild = preferGuildId ? client.guilds.cache.get(preferGuildId) : client.guilds.cache.first();
  
  if (!guild) {
    return interaction.editReply('Unable to find the guild for the check.');
  }

  let confirmed = 0, failed = 0, stillWaiting = 0;

  for (const ref of holdingOnly) {
    const elapsedDays = (now - ref.confirm_started_at) / 86400;
    
    if (elapsedDays >= holdDays) {
      try {
        const member = await guild.members.fetch(ref.invitee_id);
        const requiredRoleId = (await db.getConfig(db._db, 'required_role_id')) || process.env.REQUIRED_ROLE_ID;
        
        if (requiredRoleId && member.roles.cache.has(requiredRoleId)) {
          // Kept the role for the hold duration - confirm
          await db.confirmReferral(db._db, ref.invitee_id);
          
          // Trigger notifications and rewards
          const helpers = {
            async notifyInviter(inviterId, message) {
              try {
                const user = await client.users.fetch(inviterId);
                await user.send(message);
              } catch {}
            },
            async onReferralConfirmed(inviterId, inviteeId) {
              await this.notifyInviter(inviterId, `Referral confirmed: <@${inviteeId}>! 🎉`);
              const count = await db.getConfirmedCount(db._db, inviterId);
              const rawT1 = (await db.getConfig(db._db, 'reward_tier1')) || process.env.REWARD_TIER1 || '5';
              const rawT2 = (await db.getConfig(db._db, 'reward_tier2')) || process.env.REWARD_TIER2 || '15';
              const t1 = parseInt(rawT1, 10);
              const t2 = parseInt(rawT2, 10);
              const rewardChId = (await db.getConfig(db._db, 'reward_channel_id')) || process.env.REWARD_CHANNEL_ID || (await db.getConfig(db._db, 'invite_channel_id')) || process.env.INVITE_CHANNEL_ID;
              const staffRoleId = (await db.getConfig(db._db, 'staff_role_id')) || process.env.STAFF_ROLE_ID;

              if ((count === t1 || count === t2) && !(await db.hasReward(db._db, inviterId, count))) {
                await db.markReward(db._db, inviterId, count);
                const staffTag = staffRoleId ? ` <@&${staffRoleId}>` : '';
                const msg = `🎁 <@${inviterId}> reached ${count} confirmed referrals!${staffTag}`;
                if (rewardChId) {
                  const ch = await client.channels.fetch(rewardChId).catch(() => null);
                  ch?.send(msg);
                }
              }
            }
          };
          
          await helpers.onReferralConfirmed(ref.inviter_id, ref.invitee_id);
          confirmed++;
        } else {
          // Role lost - fail
          await db.failReferral(db._db, ref.invitee_id, 'role_lost');
          await db.addTokens(db._db, ref.inviter_id, +1);
          
          const helpers = {
            async notifyInviter(inviterId, message) {
              try {
                const user = await client.users.fetch(inviterId);
                await user.send(message);
              } catch {}
            }
          };
          
          await helpers.notifyInviter(ref.inviter_id, `Referral for <@${ref.invitee_id}> did not keep the role; token refunded.`);
          failed++;
        }
      } catch (e) {
        // User not found (left) - fail
        await db.failReferral(db._db, ref.invitee_id, 'left');
        await db.addTokens(db._db, ref.inviter_id, +1);
        
        const helpers = {
          async notifyInviter(inviterId, message) {
            try {
              const user = await client.users.fetch(inviterId);
              await user.send(message);
            } catch {}
          }
        };
        
          await helpers.notifyInviter(ref.inviter_id, `Referral for <@${ref.invitee_id}> left the server; token refunded.`);
        failed++;
      }
    } else {
      stillWaiting++;
    }
  }

  // Update the leaderboard if confirmations occurred
  if (confirmed > 0) {
    try {
      const { upsertLeaderboardMessage } = require('../index');
      await upsertLeaderboardMessage();
    } catch (e) {
      console.warn('Leaderboard update error:', e.message);
    }
  }

  const msg = `✅ Check completed!\n🎉 Confirmed: ${confirmed}\n❌ Failed: ${failed}\n⏳ Waiting: ${stillWaiting}`;
  return interaction.editReply(msg);
}

async function checkPending(interaction, db) {
  const staffRoleId = (await db.getConfig(db._db, 'staff_role_id')) || process.env.STAFF_ROLE_ID;
  if (staffRoleId && !interaction.member.roles.cache.has(staffRoleId)) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Only staff can use this command.' });
  }

  const holdDays = parseInt((await db.getConfig(db._db, 'confirm_hold_days')) || '7', 10);
  const now = Math.floor(Date.now() / 1000);
  const pending = await db.getPendingHolding(db._db);
  
  // Filter referrals in holding status
  const holding = pending.filter(ref => ref.status === 'holding' && ref.confirm_started_at);
  
  if (!holding.length) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '✅ No referrals currently in holding.' });
  }

  const tz = (await db.getConfig(db._db, 'timezone')) || 'Europe/Rome';
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' });

  const lines = holding.map(ref => {
    const elapsedSeconds = now - ref.confirm_started_at;
    const elapsedDays = elapsedSeconds / 86400;
    const remainingDays = Math.max(0, holdDays - elapsedDays);
    
    let status;
    if (remainingDays <= 0) {
      status = '🟢 Ready for confirmation';
    } else if (remainingDays <= 1) {
      const remainingHours = Math.ceil(remainingDays * 24);
      status = `🟡 ${remainingHours}h remaining`;
    } else {
      status = `🔵 ${Math.ceil(remainingDays)} days remaining`;
    }
    
    const startDate = fmt.format(new Date(ref.confirm_started_at * 1000));
    return `• <@${ref.invitee_id}> (from <@${ref.inviter_id}>)\n  ${status} - Holding since: ${startDate}`;
  });

  // Split into chunks if too long for Discord message limit
  const maxLength = 1900; // Leave room for header
  const header = `📋 **Referrals in Holding (${holding.length})**\n⏱️ Days to automatic confirmation: ${holdDays}\n\n`;
  
  let currentMessage = header;
  const messages = [];
  
  for (const line of lines) {
    if ((currentMessage + line + '\n').length > maxLength) {
      messages.push(currentMessage);
      currentMessage = header + line + '\n';
    } else {
      currentMessage += line + '\n';
    }
  }
  
  if (currentMessage !== header) {
    messages.push(currentMessage);
  }

  // Send first message as reply
  await interaction.reply({ flags: MessageFlags.Ephemeral, content: messages[0] });
  
  // Send additional messages as follow-ups if needed
  for (let i = 1; i < messages.length; i++) {
    await interaction.followUp({ flags: MessageFlags.Ephemeral, content: messages[i] });
  }
}

module.exports = { definitions, handlerFactory };
