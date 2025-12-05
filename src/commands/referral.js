const { PermissionFlagsBits, MessageFlags } = require('discord.js');

function definitions() {
  return [
    {
      name: 'referral',
      description: 'Referral tools',
      options: [
        {
          type: 1,
          name: 'link',
          description: 'Show or create your personal invite link',
        },
        {
          type: 1,
          name: 'stats',
          description: 'Your referral stats',
        },
        {
          type: 1,
          name: 'leaderboard',
          description: 'Referral leaderboard',
          options: [
            {
              type: 3,
              name: 'period',
              description: 'Period (week|month|all)',
              required: false,
              choices: [
                { name: 'week', value: 'week' },
                { name: 'month', value: 'month' },
                { name: 'all', value: 'all' },
              ],
            },
          ],
        },
      ],
    },
  ];
}

function handlerFactory({ db }) {
  return {
    async handle(interaction) {
      if (!interaction.isChatInputCommand() || interaction.commandName !== 'referral') return;
      const sub = interaction.options.getSubcommand();
      if (sub === 'link') return link(interaction, db);
      if (sub === 'stats') return stats(interaction, db);
      if (sub === 'leaderboard') return leaderboard(interaction, db);
    },
  };
}

async function link(interaction, db) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;
  const userId = interaction.user.id;
  const tokens = await db.getTokens(db._db, userId);
  const confChId = (await db.getConfig(db._db, 'invite_channel_id')) || process.env.INVITE_CHANNEL_ID;
  if (!confChId) return interaction.editReply('Invite channel not configured. An admin should set it in config.');

  // Check role allowed to create invite, if configured
  const requiredRole = (await db.getConfig(db._db, 'link_creator_role_id')) || process.env.LINK_CREATOR_ROLE_ID;
  if (requiredRole) {
    const member = await guild.members.fetch(userId);
    if (!member.roles.cache.has(requiredRole)) {
      return interaction.editReply('You are not allowed to create a personal invite link.');
    }
  }

  // If existing active invite -> return
  let inv = await db.getActiveInviteByInviter(db._db, userId);
  if (inv) {
    return interaction.editReply(`Your link: https://discord.gg/${inv.code} | Tokens left: ${tokens}`);
  }

  if (tokens <= 0) {
    return interaction.editReply('You have no tokens available this week. Wait for reset or ask an admin.');
  }

  // Create new invite
  const channel = await guild.channels.fetch(confChId).catch(() => null);
  if (!channel) return interaction.editReply('Invite channel not found.');
  let invite;
  try {
    invite = await guild.invites.create(channel, { maxAge: 0, maxUses: 0, unique: true, reason: `Referral for ${interaction.user.tag}` });
  } catch (e) {
    return interaction.editReply('Unable to create invite. Check bot permissions (Manage Guild/Channels).');
  }
  await db.createInviteRecord(db._db, invite.code, userId, channel.id, Math.floor((invite.createdTimestamp || Date.now()) / 1000));
  return interaction.editReply(`Your link: https://discord.gg/${invite.code} | Tokens left: ${tokens}`);
}

async function stats(interaction, db) {
  const s = await db.getUserStats(db._db, interaction.user.id);
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: `Tokens: ${s.tokens}\nPending: ${s.pending}\nConfirmed: ${s.confirmed}\nFailed: ${s.failed}`,
  });
}

async function leaderboard(interaction, db) {
  const period = interaction.options.getString('period') || 'all';
  const rows = await db.getLeaderboard(db._db, period);
  const confChId = (await db.getConfig(db._db, 'invite_channel_id')) || process.env.INVITE_CHANNEL_ID;
  const ephem = confChId && interaction.channelId === confChId;
  if (!rows.length) return interaction.reply({ flags: MessageFlags.Ephemeral, content: 'No leaderboard data yet.' });
  const lines = rows.map((r, i) => `${i + 1}. <@${r.inviter_id}> — ${r.confirmed}`);
  const options = { content: `Leaderboard (${period}):\n` + lines.join('\n') };
  if (ephem) options.flags = MessageFlags.Ephemeral;
  await interaction.reply(options);
}

module.exports = { definitions, handlerFactory };
