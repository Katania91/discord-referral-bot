require('dotenv').config();
const { REST, Routes } = require('discord.js');
const referral = require('./commands/referral');
const admin = require('./commands/admin');
const staff = require('./commands/staff');

async function main() {
  const token = process.env.DISCORD_TOKEN;
  const appId = process.env.APPLICATION_ID;
  const guildId = process.env.GUILD_ID;
  if (!token || !appId) throw new Error('DISCORD_TOKEN and APPLICATION_ID are required');

  const body = [ ...referral.definitions(), ...admin.definitions(), ...staff.definitions() ];
  const rest = new REST({ version: '10' }).setToken(token);
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
    console.log('Commands registered at GUILD scope');
  } else {
    await rest.put(Routes.applicationCommands(appId), { body });
    console.log('Commands registered at GLOBAL scope (can take up to 1h)');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
