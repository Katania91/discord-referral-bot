const { PermissionFlagsBits, MessageFlags } = require('discord.js');

function definitions() {
  return [
    {
      name: 'admin',
      description: 'Admin commands (management)',
      default_member_permissions: String(PermissionFlagsBits.Administrator),
      dm_permission: false,
      options: [
        { type: 1, name: 'set-hold', description: 'Days to keep the role before confirmation', options: [ { type: 4, name: 'days', description: 'Days', required: true } ] },
        { type: 1, name: 'grant-tokens', description: 'Add/remove tokens for a user', options: [ { type: 6, name: 'user', description: 'User', required: true }, { type: 4, name: 'n', description: 'Amount (+/-)', required: true } ] },
        { type: 1, name: 'reset-tokens', description: 'Manual weekly reset' },
      ],
    },
  ];
}

function handlerFactory({ db }) {
  return {
    async handle(interaction) {
      if (!interaction.isChatInputCommand() || interaction.commandName !== 'admin') return;
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Permission denied.' });
      }
      const sub = interaction.options.getSubcommand();
      if (sub === 'set-hold') return setHold(interaction, db);
      if (sub === 'grant-tokens') return grantTokens(interaction, db);
      if (sub === 'reset-tokens') return resetTokens(interaction, db);
    },
  };
}

async function setHold(interaction, db) {
  const days = interaction.options.getInteger('days');
  await db.setConfig(db._db, 'confirm_hold_days', String(days));
  return interaction.reply({ flags: MessageFlags.Ephemeral, content: `Hold period set to ${days} days.` });
}
async function grantTokens(interaction, db) {
  const user = interaction.options.getUser('user', true);
  const n = interaction.options.getInteger('n', true);
  await db.addTokens(db._db, user.id, n);
  return interaction.reply({ flags: MessageFlags.Ephemeral, content: `Assigned ${n} tokens to ${user}.` });
}
async function resetTokens(interaction, db) {
  await db.resetAllTokens(db._db);
  return interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Weekly token reset executed.' });
}

module.exports = { definitions, handlerFactory };
