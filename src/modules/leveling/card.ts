import sharp from "sharp";
import type { GuildMember } from "discord.js";
import type { LevelReward } from "./store.js";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function compact(value: string, maximum: number): string {
  const clean = value
    .replace(/\s*[・･]\s*/gu, " • ")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return clean.length > maximum ? `${clean.slice(0, maximum - 3).trimEnd()}...` : clean;
}

export function levelRewardRoleLabel(roleName: string, rewardEmoji: string): string {
  const cleanName = roleName.trim();
  const emoji = rewardEmoji.trim();
  if (!emoji || !cleanName.startsWith(emoji)) return cleanName;
  return cleanName.slice(emoji.length).replace(/^[\s・•|—–-]+/u, "").trim() || cleanName;
}

async function imageDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Falha ao baixar imagem do card de nível (${response.status}).`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0] || "image/png";
  return `data:${contentType};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
}

export function levelUpCardSvg(values: {
  avatarDataUrl: string;
  memberName: string;
  rewardTitle: string;
  rewardLevel: number;
  rewardRole: string;
  rewardShortMessage: string;
}): string {
  const memberName = escapeXml(compact(values.memberName, 30));
  const rewardSummary = escapeXml(compact(values.rewardRole, 32));
  const footerMessage = escapeXml(compact(values.rewardTitle, 84));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="770" height="245" viewBox="0 0 660 210">
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#342035"/><stop offset=".55" stop-color="#55263F"/><stop offset="1" stop-color="#79304D"/></linearGradient>
    <linearGradient id="pink" x2="1" y2="1"><stop stop-color="#FFF0F4"/><stop offset=".5" stop-color="#FFC0D8"/><stop offset="1" stop-color="#F58BB5"/></linearGradient>
    <radialGradient id="glow"><stop stop-color="#F899BE" stop-opacity=".3"/><stop offset="1" stop-color="#F899BE" stop-opacity="0"/></radialGradient>
    <clipPath id="avatar"><circle cx="76" cy="74" r="44"/></clipPath>
    <clipPath id="panels"><rect x="12" y="10" width="636" height="126" rx="16"/><rect x="12" y="150" width="636" height="50" rx="12"/></clipPath>
    <g id="swan" shape-rendering="crispEdges">
      <path d="M20 0H60V10H70V20H80V40H70V30H60V20H40V30H30V50H40V60H50V90H40V110H20V120H-40V110H-60V90H-70V70H-60V80H-40V70H-20V80H0V70H10V40H0V20H10V10H20Z" fill="#FFF0F4"/>
      <path d="M20 10H60V20H40V30H30V50H20V70H10V90H-40V100H20V90H30V60H20V40H10V20H20Z" fill="#F8B5CE"/>
      <path d="M-60 80H-40V90H-20V100H20V110H-40V100H-60Z" fill="#EE6EAA"/>
      <path d="M60 20H70V30H80V40H70V30H60Z" fill="#FFAA98"/>
      <rect x="50" y="20" width="10" height="10" fill="#9E174B"/>
    </g>
  </defs>
  <g clip-path="url(#panels)">
    <rect x="12" y="10" width="636" height="190" fill="url(#panel)"/>
    <ellipse cx="445" cy="50" rx="270" ry="170" fill="url(#glow)"/>
    <use href="#swan" transform="translate(380 19) scale(1.25)" opacity=".065"/>
    <g shape-rendering="crispEdges">
      <path d="M451 22h5v5h5v5h-5v5h-5v-5h-5v-5h5Z" fill="#FFD6E5" opacity=".35"/>
      <rect x="164" y="22" width="4" height="4" fill="#FFAA98" opacity=".35"/>
      <rect x="365" y="113" width="5" height="5" fill="#F58BB5" opacity=".3"/>
      <path d="M614 161h4v4h4v4h-4v4h-4v-4h-4v-4h4Z" fill="#FFAA98" opacity=".25"/>
    </g>
  </g>
  <rect x="12" y="10" width="636" height="126" rx="16" fill="none" stroke="#FFD8EB" stroke-opacity=".3"/>
  <circle cx="76" cy="74" r="48" fill="#342035" stroke="url(#pink)" stroke-width="2"/>
  <image x="32" y="30" width="88" height="88" href="${values.avatarDataUrl}" clip-path="url(#avatar)" preserveAspectRatio="xMidYMid slice"/>
  <text x="142" y="67" fill="#FFF1F8" font-family="Arial, sans-serif" font-size="25" font-weight="700">${memberName}</text>
  <text x="142" y="97" fill="#E9C4D5" font-family="Arial, sans-serif" font-size="17"><tspan font-weight="700">Cargo recebido:</tspan> ${rewardSummary}</text>
  <text x="550" y="43" text-anchor="middle" fill="#F8BEDA" font-family="Arial, sans-serif" font-size="10" font-weight="700" letter-spacing="1">NÍVEL AUMENTADO</text>
  <text x="550" y="108" text-anchor="middle" fill="url(#pink)" font-family="Arial, sans-serif" font-size="62" font-weight="700">${values.rewardLevel}</text>
  <path d="M630 25h4v4h4v4h-4v4h-4v-4h-4v-4h4Z" fill="#FFD8EB" opacity=".65"/>
  <rect x="12" y="150" width="636" height="50" rx="12" fill="none" stroke="#FFD8EB" stroke-opacity=".25"/>
  <text x="330" y="182" text-anchor="middle" fill="#F5DBE7" font-family="Arial, sans-serif" font-size="16">${footerMessage}</text>
</svg>`;
}

export async function generateLevelUpCard(member: GuildMember, reward: LevelReward): Promise<Buffer> {
  const avatarUrl = member.displayAvatarURL({ extension: "png", size: 256, forceStatic: true });
  const avatarDataUrl = await imageDataUrl(avatarUrl);
  const role = member.guild.roles.cache.get(reward.roleId);
  const rewardRole = levelRewardRoleLabel(role?.name ?? "Novo cargo", reward.emoji);
  const svg = levelUpCardSvg({
    avatarDataUrl,
    memberName: member.user.username,
    rewardTitle: reward.title,
    rewardLevel: reward.level,
    rewardRole,
    rewardShortMessage: reward.shortMessage,
  });
  return sharp(Buffer.from(svg), { density: 144 }).png({ quality: 100, compressionLevel: 9 }).toBuffer();
}

export function rankCardSvg(values: {
  avatarDataUrl: string;
  memberName: string;
  currentLevel: number;
  currentLevelXp: number;
  xpRequired: number;
  serverPosition: number;
}): string {
  const memberName = escapeXml(compact(values.memberName, 30));
  const progressPercent = Math.max(0, Math.min(100,
    values.xpRequired > 0 ? (values.currentLevelXp / values.xpRequired) * 100 : 0,
  ));
  const progressWidth = (326 * progressPercent) / 100;
  const currentLevelXp = values.currentLevelXp.toLocaleString("pt-BR");
  const xpRequired = values.xpRequired.toLocaleString("pt-BR");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="770" height="245" viewBox="0 0 660 210">
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#342035"/><stop offset=".55" stop-color="#55263F"/><stop offset="1" stop-color="#79304D"/></linearGradient>
    <linearGradient id="pink" x2="1" y2="1"><stop stop-color="#FFF0F4"/><stop offset=".5" stop-color="#FFC0D8"/><stop offset="1" stop-color="#F58BB5"/></linearGradient>
    <radialGradient id="glow"><stop stop-color="#F899BE" stop-opacity=".3"/><stop offset="1" stop-color="#F899BE" stop-opacity="0"/></radialGradient>
    <clipPath id="avatar"><circle cx="76" cy="74" r="44"/></clipPath>
    <clipPath id="panels"><rect x="12" y="10" width="636" height="126" rx="16"/><rect x="12" y="150" width="636" height="50" rx="12"/></clipPath>
    <clipPath id="progress"><rect x="142" y="106" width="326" height="10" rx="5"/></clipPath>
    <g id="swan" shape-rendering="crispEdges">
      <path d="M20 0H60V10H70V20H80V40H70V30H60V20H40V30H30V50H40V60H50V90H40V110H20V120H-40V110H-60V90H-70V70H-60V80H-40V70H-20V80H0V70H10V40H0V20H10V10H20Z" fill="#FFF0F4"/>
      <path d="M20 10H60V20H40V30H30V50H20V70H10V90H-40V100H20V90H30V60H20V40H10V20H20Z" fill="#F8B5CE"/>
      <path d="M-60 80H-40V90H-20V100H20V110H-40V100H-60Z" fill="#EE6EAA"/>
      <path d="M60 20H70V30H80V40H70V30H60Z" fill="#FFAA98"/>
      <rect x="50" y="20" width="10" height="10" fill="#9E174B"/>
    </g>
  </defs>
  <g clip-path="url(#panels)">
    <rect x="12" y="10" width="636" height="190" fill="url(#panel)"/>
    <ellipse cx="445" cy="50" rx="270" ry="170" fill="url(#glow)"/>
    <use href="#swan" transform="translate(380 19) scale(1.25)" opacity=".065"/>
    <g shape-rendering="crispEdges">
      <path d="M451 22h5v5h5v5h-5v5h-5v-5h-5v-5h5Z" fill="#FFD6E5" opacity=".35"/>
      <rect x="164" y="22" width="4" height="4" fill="#FFAA98" opacity=".35"/>
      <rect x="365" y="113" width="5" height="5" fill="#F58BB5" opacity=".3"/>
      <path d="M614 161h4v4h4v4h-4v4h-4v-4h-4v-4h4Z" fill="#FFAA98" opacity=".25"/>
    </g>
  </g>
  <rect x="12" y="10" width="636" height="126" rx="16" fill="none" stroke="#FFD8EB" stroke-opacity=".3"/>
  <circle cx="76" cy="74" r="48" fill="#342035" stroke="url(#pink)" stroke-width="2"/>
  <image x="32" y="30" width="88" height="88" href="${values.avatarDataUrl}" clip-path="url(#avatar)" preserveAspectRatio="xMidYMid slice"/>
  <text x="142" y="61" fill="#FFF1F8" font-family="Arial, sans-serif" font-size="25" font-weight="700">${memberName}</text>
  <text x="142" y="94" fill="#E9C4D5" font-family="Arial, sans-serif" font-size="17">${currentLevelXp} / ${xpRequired} XP</text>
  <text x="468" y="94" text-anchor="end" fill="#FFD8EB" font-family="Arial, sans-serif" font-size="17" font-weight="700">${progressPercent.toFixed(1)}%</text>
  <rect x="142" y="106" width="326" height="10" rx="5" fill="#211725" fill-opacity=".65"/>
  <g clip-path="url(#progress)"><rect x="142" y="106" width="${progressWidth}" height="10" fill="url(#pink)"/></g>
  <rect x="142" y="106" width="326" height="10" rx="5" fill="none" stroke="#FFD8EB" stroke-opacity=".16"/>
  <text x="550" y="43" text-anchor="middle" fill="#F8BEDA" font-family="Arial, sans-serif" font-size="10" font-weight="700" letter-spacing="1">NÍVEL ATUAL</text>
  <text x="550" y="108" text-anchor="middle" fill="url(#pink)" font-family="Arial, sans-serif" font-size="62" font-weight="700">${values.currentLevel}</text>
  <path d="M630 25h4v4h4v4h-4v4h-4v-4h-4v-4h4Z" fill="#FFD8EB" opacity=".65"/>
  <rect x="12" y="150" width="636" height="50" rx="12" fill="none" stroke="#FFD8EB" stroke-opacity=".25"/>
  <text x="330" y="182" text-anchor="middle" fill="#F5DBE7" font-family="Arial, sans-serif" font-size="16">Posição no servidor: <tspan fill="#FFD8EB" font-weight="700">#${values.serverPosition}</tspan></text>
</svg>`;
}

export async function generateRankCard(member: GuildMember, values: {
  currentLevel: number;
  currentLevelXp: number;
  xpRequired: number;
  serverPosition: number;
}): Promise<Buffer> {
  const avatarUrl = member.displayAvatarURL({ extension: "png", size: 256, forceStatic: true });
  const avatarDataUrl = await imageDataUrl(avatarUrl);
  const svg = rankCardSvg({ avatarDataUrl, memberName: member.user.username, ...values });
  return sharp(Buffer.from(svg), { density: 144 }).png({ quality: 100, compressionLevel: 9 }).toBuffer();
}

type TopCardRow = { userId: string; level: number; xpTotal: number; position?: number };
type TopCardProfile = { name: string; avatarDataUrl: string };

export function top10CardSvg(rows: TopCardRow[], profiles: Record<string, TopCardProfile>): string {
  const number = (value: number) => escapeXml(value.toLocaleString("pt-BR"));
  const members = rows.slice(0, 5).map((row, index) => ({
    position: row.position ?? index + 1,
    name: profiles[row.userId]?.name || `Usuário ${row.userId}`,
    avatar: profiles[row.userId]?.avatarDataUrl || "",
    level: number(row.level),
    xp: number(row.xpTotal),
  }));

  const avatar = (member: (typeof members)[number], cx: number, cy: number, radius: number) => {
    const clipId = `avatar-${member.position}`;
    const initial = escapeXml(Array.from(member.name)[0] || "?");
    return `<defs><clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${radius}"/></clipPath></defs>
      <circle cx="${cx}" cy="${cy}" r="${radius + 3}" fill="#342035" stroke="url(#pink)" stroke-width="1.5"/>
      ${member.avatar
        ? `<image x="${cx - radius}" y="${cy - radius}" width="${radius * 2}" height="${radius * 2}" href="${escapeXml(member.avatar)}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice"/>`
        : `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="#63334F"/><text x="${cx}" y="${cy}" dominant-baseline="central" text-anchor="middle" fill="#FFD8EB" font-size="${radius}" font-weight="700">${initial}</text>`}`;
  };

  const panel = (x: number, y: number, width: number, height: number, radius: number, content: string, featured = false) => {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="none" stroke="${featured ? "#FFC0D8" : "#FFD8EB"}" stroke-opacity="${featured ? ".42" : ".22"}"/>
      ${content}`;
  };

  const ranking = members.map((member, index) => {
    const y = 12 + index * 100;
    const colors = ["#FFE0A3", "#E9DFEF", "#F3B49E", "#C9B8FF", "#9EDCF3", "#F8BEDA", "#B8F0D0", "#FFBFA3", "#D3B8EF", "#BFD4FF"];
    const positionColor = colors[member.position - 1] ?? "#F8BEDA";
    const position = `#${member.position}`;
    return panel(12, y, 736, 90, 16, `
      <text x="62" y="${y + 53}" text-anchor="middle" fill="${positionColor}" font-size="18" font-weight="700">${position}</text>
      ${avatar(member, 142, y + 45, 31)}
      <text x="194" y="${y + 53}" fill="#FFF1F8" font-size="23" font-weight="700">${escapeXml(compact(member.name, 25))}</text>
      <text x="545" y="${y + 31}" text-anchor="middle" fill="#D6AEC2" font-size="13" font-weight="700" letter-spacing="1">NÍVEL</text>
      <text x="545" y="${y + 63}" text-anchor="middle" fill="#FFD8EB" font-size="22" font-weight="700">${member.level}</text>
      <text x="680" y="${y + 31}" text-anchor="middle" fill="#D6AEC2" font-size="13" font-weight="700" letter-spacing="1">XP TOTAL</text>
      <text x="680" y="${y + 63}" text-anchor="middle" fill="#EED5E3" font-size="20" font-weight="700">${member.xp}</text>`, member.position === 1);
  }).join("");

  const height = members.length ? 12 + members.length * 100 : 110;
  const outputHeight = Math.round(height * 1000 / 760);
  const panelClips = members.map((_, index) => `<rect x="12" y="${12 + index * 100}" width="736" height="90" rx="16"/>`).join("");
  const swans = members.map((_, index) => `<use href="#swan" transform="translate(500 ${20 + index * 100}) scale(.6)" opacity=".065"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${outputHeight}" viewBox="0 0 760 ${height}">
    <defs>
      <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#342035"/><stop offset=".55" stop-color="#55263F"/><stop offset="1" stop-color="#79304D"/></linearGradient>
      <linearGradient id="pink" x2="1" y2="1"><stop stop-color="#FFF0F4"/><stop offset=".5" stop-color="#FFC0D8"/><stop offset="1" stop-color="#F58BB5"/></linearGradient>
      <radialGradient id="glow"><stop stop-color="#F899BE" stop-opacity=".3"/><stop offset="1" stop-color="#F899BE" stop-opacity="0"/></radialGradient>
      <clipPath id="ranking-panels">${panelClips}</clipPath>
      <g id="swan" shape-rendering="crispEdges">
        <path d="M20 0H60V10H70V20H80V40H70V30H60V20H40V30H30V50H40V60H50V90H40V110H20V120H-40V110H-60V90H-70V70H-60V80H-40V70H-20V80H0V70H10V40H0V20H10V10H20Z" fill="#FFF0F4"/>
        <path d="M20 10H60V20H40V30H30V50H20V70H10V90H-40V100H20V90H30V60H20V40H10V20H20Z" fill="#F8B5CE"/>
        <path d="M-60 80H-40V90H-20V100H20V110H-40V100H-60Z" fill="#EE6EAA"/>
        <path d="M60 20H70V30H80V40H70V30H60Z" fill="#FFAA98"/><rect x="50" y="20" width="10" height="10" fill="#9E174B"/>
      </g>
    </defs>
    <g clip-path="url(#ranking-panels)">
      <rect x="12" y="12" width="736" height="${Math.max(90, height - 12)}" fill="url(#panel)"/>
      <ellipse cx="535" cy="${height * .32}" rx="420" ry="${Math.max(190, height * .7)}" fill="url(#glow)"/>
      ${swans}
    </g>
    <g font-family="Arial, sans-serif">
      ${ranking}
      ${members.length === 0 ? `<text x="380" y="60" text-anchor="middle" fill="#E9C4D5" font-size="18">Ainda não há membros no ranking.</text>` : ""}
    </g>
  </svg>`;
}

export async function generateTop10Card(entries: Array<{ member: GuildMember; level: number; xpTotal: number; position?: number }>): Promise<Buffer> {
  const profiles: Record<string, TopCardProfile> = {};
  await Promise.all(entries.map(async ({ member }) => {
    const avatarUrl = member.displayAvatarURL({ extension: "png", size: 128, forceStatic: true });
    profiles[member.id] = { name: member.user.username, avatarDataUrl: await imageDataUrl(avatarUrl) };
  }));
  const svg = top10CardSvg(
    entries.map(({ member, level, xpTotal, position }) => ({ userId: member.id, level, xpTotal, position })),
    profiles,
  );
  return sharp(Buffer.from(svg), { density: 144 }).png({ quality: 100, compressionLevel: 9 }).toBuffer();
}
