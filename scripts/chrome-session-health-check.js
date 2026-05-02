const {
  getChromeSessionConfig,
  ensureChromeSessionProxy,
  listChromeTargets
} = require('../hermes/enrichment/chromeSessionClient');

async function main() {
  const config = getChromeSessionConfig({
    ...process.env,
    HERMES_CHROME_SESSION_ENABLED: process.env.HERMES_CHROME_SESSION_ENABLED || 'true'
  });

  await ensureChromeSessionProxy(config);
  const targets = await listChromeTargets({ config });

  console.log(JSON.stringify({
    ok: true,
    proxyUrl: config.url,
    targetCount: Array.isArray(targets.targets) ? targets.targets.length : 0,
    targets: targets.targets || []
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
