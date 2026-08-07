import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { basename, join, normalize, posix, resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const distDir = join(rootDir, 'dist');
const browserArgIndex = process.argv.indexOf('--browser');
const requestedBrowsers = browserArgIndex >= 0
  ? [process.argv[browserArgIndex + 1]]
  : ['chrome', 'edge', 'firefox'];

if (requestedBrowsers.some((browser) => !browser)) {
  throw new Error('Usage: sidepanel-chunk-budget.mjs [--browser chrome|edge|firefox]');
}

// R6.4 Chrome baseline, re-captured after c6e00d3 (local-skill management feature)
// with WXT 0.20.26, then re-baselined for that feature's activation / path-rewrite /
// scoring / cwd-enforcement code, and again for the SkillPage / SkillCard
// update-button loading + busy + acceptFailure feedback added on this PR.
// Refreshed for the agent-harness PR (#490, head 0c0e7c8): main @ 60678ef
// measured 365345 raw / 110321 gzip under Node 22 (3 bytes below the old
// budget); the PR adds four content.agent i18n keys (zh/en) for the
// structured step UI (+331 raw / +82 gzip). Measurements are Node-22 zlib
// values; keep the GZIP_ENCODER_VARIANCE_BYTES allowance below.
// Refreshed for #475 (PR #491, head bbd2064): trusted-directory settings
// subpage + chat @ panel add 29 i18n keys (zh/en) plus their strings to the
// initial shell. CI Node-22 measurement: 369698 raw / 111410 gzip (+4022 /
// +1007 over the previous baseline); local Node-25 zlib measures 111279,
// within the encoder variance allowance.
// Refreshed for the #495-#499 batch (head 90ef4ad): settings data subpage
// log-export entry (#495) plus export-scope / auto-save / copy-output i18n
// keys (#497-#499) add to the initial shell. Local Node-25 measurement:
// 372032 raw / 111777 gzip (+2334 / +367 over the previous baseline); the
// encoder variance allowance covers CI Node-22 gzip drift.
// This PR ALSO adds the local-skill management surface (SkillPage / SkillCard /
// activation / path-rewrite / scoring / cwd-enforcement); the combined footprint
// was re-measured after merging main (#504): post-merge Node-25 measurement
// 375456 raw / 112742 gzip; the initialShell below is set to the actual
// post-merge build measurement so the budget guardrail stays meaningful.
// Refreshed for the background i18n slimming (#505/#506): background-bundled
// modules now import the slim core/i18n/background slice instead of the full
// resource tree, which changed the shared-module graph and rollup's chunk
// grouping. Content is essentially unchanged (+216 raw, +0.06%); the i18n
// resources moved from their own chunk into the entry chunk and a new shared
// runtime chunk appeared, so the gzip total regroups too. Local Node-25
// measurement: 375672 raw / 114387 gzip; CI Node-22 zlib measures 114659 gzip
// (+272 encoder variance); the baseline below uses the CI measurement so the
// guardrail stays green on both runtimes.
// Refreshed for #528 (issue-528 empty-history export guard + copy failure
// visibility): four i18n strings (background.export.emptyHistory and
// content.uxPolish.copyMessageFailed in zh-CN/en) were added to the shared
// resource tree that now lives in the entry chunk. Local Node-25 measurement:
// 376072 raw (+400) / 114511 gzip (still under the CI-derived gzip baseline).
// Refreshed for #541 (inline-agent P0 UI/UX batch): content.agent.footerPaused
// in zh-CN/en was added to the shared resource tree. Local Node-25 measurement:
// 376246 raw (+174) / 114549 gzip; the raw baseline below is updated to the
// measured value, gzip stays under the CI-derived baseline (114659). The
// firstChatScreen raw cap below is raised 406328 -> 406502 by the same +174.
// Refreshed for #544 (inline-agent P1 UI/UX batch): content.agent.starting and
// content.agent.interrupted in zh-CN/en were added to the shared resource tree.
// Local Node-25 measurement: 376367 raw (+121) / 114583 gzip; raw baseline
// updated again, gzip stays under the CI-derived baseline. firstChatScreen raw
// cap raised 406502 -> 406623 by the same +121.
// Refreshed for #544 follow-up (silent-failure feedback): content.agent.startFailed
// in zh-CN/en was added to the shared resource tree. Local Node-25 measurement:
// 376486 raw (+119) / 114604 gzip; raw baseline updated again, gzip stays under
// the CI-derived baseline. firstChatScreen raw cap raised 406623 -> 406742 by
// the same +119.
// Refreshed for the local-skill import strict-frontmatter / real-definition-file
// PR (#550, head 1e5ea88): the LocalSkillImportPanel now renders local Skill
// kind labels and contract violations, adding zh-CN/en i18n keys (sidepanel.*
// kind labels + violation messages) and the rendering code into the shared
// resource tree / entry chunk that already lives in the initial shell. CI
// Node-22 measurement matches the local Node-24 measurement exactly: initial
// shell 378053 raw / 115502 gzip (+1567 raw / +843 gzip over the #544
// follow-up baseline of 376486 / 114659); first chat screen 408309 raw /
// 125542 gzip (+1567 raw / +920 gzip). The initialShell baseline below is set
// to the measured values; firstChatScreen raw cap is raised 406742 -> 408309
// by the same +1567, and its gzip cap is raised 125000 -> 125800 to keep the
// +256 encoder-variance allowance that the initialShell budget already grants.
// The initial shell is sidepanel.html's entry script plus every static modulepreload.
const BASELINE = Object.freeze({
  initialShell: { raw: 378_053, gzip: 115_502 },
  routeChunks: {
    ChatPage: { raw: 134_938, gzip: 40_056 },
    CapabilitiesPage: { raw: 160_137, gzip: 35_259 },
    SettingsPage: { raw: 81_914, gzip: 20_503 },
    LibraryPage: { raw: 1_451, gzip: 728 },
    MemoryPage: { raw: 4_493, gzip: 1_837 },
    SavedPage: { raw: 7_928, gzip: 2_787 },
  },
});

// W2.6 pre-change Chrome measurement at 450b5e2. The rich Markdown renderer
// was part of ChatPage's static graph, leaving less than 1% budget headroom.
// firstChatScreen raw cap raised 400000 -> 400500 for #475: the @ panel
// measured 399840 at PR #491 head bbd2064 (160B headroom), and the review
// fix for extension-classified image MIME normalization added 249B (400089
// measured locally). gzip stays 122000 (121346 measured).
const WAVE_2_CHAT_BASELINE = Object.freeze({
  firstChatScreen: { raw: 498_013, gzip: 150_087 },
  ChatPage: { raw: 134_902, gzip: 40_039 },
});

// firstChatScreen raw cap raised 400500 -> 402500 for the #495-#499 batch
// (head 90ef4ad): the shared i18n additions for export scope (#499), agent
// auto-save (#497), copy-full-output (#498), and the settings log-export
// entry (#495) also flow into the first chat screen graph. Local Node-25
// measurement: 402288 raw / 121796 gzip (+2199 raw over the #475 refresh);
// gzip stays within the existing 122000 cap.
// Raised 405800 -> 406000 (gzip 123100 -> 125000) for the background i18n
// slimming (#505/#506): the initial-shell chunk regrouping above (+216 raw)
// also flows into the first chat screen graph (ChatPage itself unchanged).
// Local Node-25 measurement: 405928 raw / 124407 gzip.

// gzip size may vary slightly between supported Node/zlib releases even when
// the built JavaScript bytes are identical. Keep the raw baseline exact and
// bound this encoder-only variance to a small fixed allowance.
const GZIP_ENCODER_VARIANCE_BYTES = 256;

// firstChatScreen raw cap raised 406000 -> 406328 for #528: the same four
// i18n strings also land in the first-chat-screen module graph (+328 raw,
// gzip 124534 stays within the 125000 cap).
// Raised 406328 -> 406502 for #541: content.agent.footerPaused (zh-CN/en)
// lands in the first-chat-screen graph too (+174 raw; gzip 124572 stays
// within the 125000 cap).
// Raised 406502 -> 406623 for #544: content.agent.starting + interrupted
// (zh-CN/en) also land in the first-chat-screen graph (+121 raw; gzip 124601
// stays within the 125000 cap).
// Raised 406623 -> 406742 for the #544 follow-up: content.agent.startFailed
// (zh-CN/en) lands in the first-chat-screen graph too (+119 raw; gzip 124622
// stays within the 125000 cap).
const BUDGET = Object.freeze({
  initialShell: {
    raw: BASELINE.initialShell.raw,
    gzip: BASELINE.initialShell.gzip + GZIP_ENCODER_VARIANCE_BYTES,
  },
  firstChatScreen: { raw: 408_309, gzip: 125_800 },
  richRendererIncrement: { raw: 120_000, gzip: 36_000 },
  routeChunks: {
    ChatPage: { raw: 25_000, gzip: 8_000 },
    LibraryPage: { raw: 2_500, gzip: 1_200 },
    MemoryPage: { raw: 6_000, gzip: 2_500 },
    SavedPage: { raw: 10_000, gzip: 4_000 },
    CapabilitiesPage: { raw: 5_000, gzip: 2_000 },
    SkillPage: { raw: 60_000, gzip: 13_000 },
    McpPage: { raw: 50_000, gzip: 12_000 },
    ToolsPage: { raw: 18_000, gzip: 6_000 },
    BrowserControlPage: { raw: 10_000, gzip: 4_000 },
    PresetPage: { raw: 14_000, gzip: 5_000 },
    AutomationPage: { raw: 35_000, gzip: 10_000 },
    SettingsPage: { raw: 45_000, gzip: 14_000 },
    GeneralSubPage: { raw: 5_000, gzip: 2_500 },
    ApiSubPage: { raw: 8_000, gzip: 3_500 },
    PromptSubPage: { raw: 14_000, gzip: 5_000 },
    VoiceSubPage: { raw: 5_000, gzip: 2_500 },
    AppearanceSubPage: { raw: 8_000, gzip: 3_500 },
    UsageSubPage: { raw: 12_000, gzip: 5_000 },
    DataSubPage: { raw: 14_000, gzip: 5_500 },
    AboutSubPage: { raw: 3_000, gzip: 1_500 },
  },
});

for (const browser of requestedBrowsers) {
  verifyBrowserBuild(browser);
}

function verifyBrowserBuild(browser) {
  const buildDir = join(distDir, `${browser}-mv3`);
  if (!existsSync(buildDir)) {
    throw new Error(`Missing ${browser} build at ${buildDir}. Run the browser build first.`);
  }

  const initialFiles = readInitialModuleFiles(buildDir);
  const initialGraph = collectStaticModuleGraph(buildDir, initialFiles);
  const initialMetric = measureFiles(buildDir, initialGraph);
  assertBudget(browser, 'initial shell', initialMetric, BUDGET.initialShell);

  const chatChunk = findNamedChunk(buildDir, 'ChatPage');
  const firstScreenGraph = collectStaticModuleGraph(buildDir, [...initialFiles, chatChunk]);
  const firstScreenMetric = measureFiles(buildDir, firstScreenGraph);
  assertBudget(browser, 'first chat screen', firstScreenMetric, BUDGET.firstChatScreen);

  const richRendererChunk = findNamedChunk(buildDir, 'RichMessageContent');
  const richRendererGraph = collectStaticModuleGraph(buildDir, [richRendererChunk]);
  const firstScreenFiles = new Set(firstScreenGraph);
  const richRendererIncrement = richRendererGraph.filter((file) => !firstScreenFiles.has(file));
  const richRendererMetric = measureFiles(buildDir, richRendererIncrement);
  assertBudget(
    browser,
    'rich message renderer static increment',
    richRendererMetric,
    BUDGET.richRendererIncrement,
  );

  const routeMetrics = {};
  for (const [chunkName, budget] of Object.entries(BUDGET.routeChunks)) {
    const chunkPath = findNamedChunk(buildDir, chunkName);
    const metric = measureFiles(buildDir, [chunkPath]);
    routeMetrics[chunkName] = metric;
    assertBudget(browser, `${chunkName} chunk`, metric, budget);
  }

  console.log(JSON.stringify({
    browser,
    baseline: BASELINE,
    gzipEncoderVarianceBytes: GZIP_ENCODER_VARIANCE_BYTES,
    wave2ChatBaseline: WAVE_2_CHAT_BASELINE,
    current: {
      initialShell: initialMetric,
      firstChatScreen: firstScreenMetric,
      richRendererIncrement: richRendererMetric,
      routeChunks: routeMetrics,
    },
  }, null, 2));
}

function readInitialModuleFiles(buildDir) {
  const html = readFileSync(join(buildDir, 'sidepanel.html'), 'utf8');
  const files = new Set();
  for (const match of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+\.js)"/g)) {
    files.add(match[1].replace(/^\//, ''));
  }
  if (files.size === 0) throw new Error('sidepanel.html does not reference a JavaScript entry.');
  return [...files];
}

function collectStaticModuleGraph(buildDir, entryFiles) {
  const pending = [...entryFiles];
  const files = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || files.has(file)) continue;
    const absolutePath = join(buildDir, file);
    if (!existsSync(absolutePath)) {
      throw new Error(`Missing Side Panel module ${file}.`);
    }
    files.add(file);
    const source = readFileSync(absolutePath, 'utf8');
    for (const match of source.matchAll(/\bimport(?:[^"'()]*?from)?["']([^"']+)["']/g)) {
      if (!match[1].startsWith('.')) continue;
      const imported = posix.normalize(posix.join(posix.dirname(file), match[1]));
      pending.push(imported);
    }
  }
  return [...files];
}

function findNamedChunk(buildDir, name) {
  const chunksDir = join(buildDir, 'chunks');
  const matches = readdirSync(chunksDir)
    .filter((file) => file.startsWith(`${name}-`) && file.endsWith('.js'));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${name} chunk in ${chunksDir}, found ${matches.length}.`);
  }
  return normalize(join('chunks', matches[0])).replaceAll('\\', '/');
}

function measureFiles(buildDir, files) {
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    const content = readFileSync(join(buildDir, file));
    raw += content.byteLength;
    gzip += gzipSync(content, { level: 9 }).byteLength;
  }
  return { raw, gzip, files: [...files].map((file) => basename(file)).sort() };
}

function assertBudget(browser, label, actual, budget) {
  if (actual.raw > budget.raw || actual.gzip > budget.gzip) {
    throw new Error(
      `${browser} ${label} exceeds budget: raw ${actual.raw}/${budget.raw}, `
      + `gzip ${actual.gzip}/${budget.gzip}.`,
    );
  }
}
