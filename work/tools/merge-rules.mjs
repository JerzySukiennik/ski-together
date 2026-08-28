// Merge SKI Together's rules block into a fresh copy of the LIVE ruleset.
//
// The Realtime Database has one ruleset for the whole instance, shared with
// every other Gzowo game. Deploying a file that contains only our block would
// delete theirs, and their multiplayer would fail silently. So: pull the live
// rules, put our block into that, and never edit anyone else's.
//
//   firebase database:get "/.settings/rules" --project gzowos-games \
//     --instance gzowos-games-default-rtdb > work/firebase/live-rules-backup.json
//   node work/tools/merge-rules.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const live = JSON.parse(strip(readFileSync('work/firebase/live-rules-backup.json', 'utf8')));
const block = JSON.parse(readFileSync('work/firebase/ski-block.json', 'utf8'));

if (!live.rules) throw new Error('live backup has no "rules" root — refusing to deploy');
const names = Object.keys(live.rules).filter((k) => !k.startsWith('.') && k !== '$other');
if (names.length < 5) throw new Error(`only ${names.length} branches in the backup — that is not the live ruleset`);

live.rules.skiTogether = block;
const header = `/*
 * The FULL ruleset for gzowos-games-default-rtdb, not just SKI Together's.
 *
 * One ruleset covers the whole instance, so deploying this file REPLACES the
 * rules for every game sharing the database. Everything outside "skiTogether"
 * is copied verbatim from the live database. Do not hand-edit it here:
 * re-pull and re-run work/tools/merge-rules.mjs instead.
 *
 * Generated ${new Date().toISOString().slice(0, 10)} from a live backup taken the same day.
 * Branches carried over: ${names.join(', ')}
 */
`;
writeFileSync('database.rules.json', header + JSON.stringify(live, null, 2) + '\n');
console.log(`merged skiTogether into ${names.length} live branches`);
