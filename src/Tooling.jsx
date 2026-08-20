import React, { useEffect, useMemo, useState } from "react";

export default function Tooling() {
  const [config, setConfig] = useState(null);
  const [copied, setCopied] = useState(false);
  const [client, setClient] = useState("claude");
  const [kiePricing, setKiePricing] = useState(null);
  const [heygenPricing, setHeygenPricing] = useState(null);

  useEffect(() => {
    fetch("/api/tooling").then((response) => response.json()).then(setConfig).catch(() => {});
    fetch("/api/kie-pricing").then((response) => response.json()).then((d) => setKiePricing(d.rows)).catch(() => {});
    fetch("/api/heygen-pricing").then((response) => response.json()).then((d) => setHeygenPricing(d.rows)).catch(() => {});
  }, []);

  const snippet = useMemo(() => {
    if (!config) return "Loading local configuration…";
    if (client === "codex") {
      return [
        "[mcp_servers.bench-studio]",
        `command = ${JSON.stringify(config.command)}`,
        `args = ${JSON.stringify(config.args)}`,
        "",
        "[mcp_servers.bench-studio.env]",
        `BENCH_URL = ${JSON.stringify(config.environment.BENCH_URL)}`,
      ].join("\n");
    }
    return JSON.stringify({
      mcpServers: {
        "bench-studio": {
          command: config.command,
          args: config.args,
          env: config.environment,
        },
      },
    }, null, 2);
  }, [client, config]);

  async function copy() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <section className="connect-page">
      <div className="connect-hero">
        <div>
          <div className="eyebrow">Local tools</div>
          <h1>Use Bench from any agent.</h1>
          <p>Claude, Codex, and Cursor can use the same model catalog, input rules, generation pipeline, costs, and local archive as this app.</p>
        </div>
        <span className="local-pill"><i /> Runs on this Mac</span>
      </div>

      <div className="connect-grid">
        <article className="connect-card connect-skill">
          <div className="connect-card-head">
            <div><span>01</span><h2>Install the Bench skill</h2></div>
            <a className="connect-primary-action" href={config?.skill?.download_url ?? "/api/tooling/skill"} download>Download ZIP</a>
          </div>
          <p>Give Codex or Claude Code the workflow: model selection, reference handling, cost discipline, and local artifact rules.</p>
          <div className="skill-package">
            <div className="skill-package-mark" aria-hidden="true"><i /><i /><i /></div>
            <div><strong>Bench Studio skill</strong><span>Portable · no credentials included</span></div>
            <small>v{config?.skill?.version ?? "0.2.0"}</small>
          </div>
          <p className="install-path">Unzip into <code>{client === "codex" ? (config?.skill?.installs?.codex ?? "~/.codex/skills/bench-studio") : (config?.skill?.installs?.claude_code ?? "~/.claude/skills/bench-studio")}</code></p>
        </article>

        <article className="connect-card connect-config">
          <div className="connect-card-head">
            <div><span>02</span><h2>Connect the live tools</h2></div>
            <button type="button" onClick={copy}>{copied ? "Copied" : "Copy config"}</button>
          </div>
          <p>The MCP server provides feature parity with this app. Bench stays available as a local background service; paste the config, then restart your client once.</p>
          <div className="client-switch" role="tablist" aria-label="MCP client">
            <button type="button" role="tab" aria-selected={client === "claude"} className={client === "claude" ? "active" : ""} onClick={() => setClient("claude")}>Claude Desktop</button>
            <button type="button" role="tab" aria-selected={client === "codex"} className={client === "codex" ? "active" : ""} onClick={() => setClient("codex")}>Codex</button>
            <button type="button" role="tab" aria-selected={client === "cursor"} className={client === "cursor" ? "active" : ""} onClick={() => setClient("cursor")}>Cursor</button>
          </div>
          <pre tabIndex="0" aria-label={`${client === "codex" ? "Codex" : client === "cursor" ? "Cursor" : "Claude Desktop"} MCP configuration`}><code>{snippet}</code></pre>
        </article>

        <article className="connect-card">
          <div className="connect-card-head"><div><span>03</span><h2>Ask naturally</h2></div></div>
          <p className="example-prompt">“Find a frugal video model that accepts two product images, generate a 9:16 UGC ad, and save the result locally.”</p>
          <div className="connect-note">Skill = judgment and workflow. MCP = live catalog, generation, projects, results, and spend.</div>
        </article>
      </div>

      <section className="tool-list-section">
        <div className="tool-list-head">
          <div><h2>Full creation surface</h2><p>Eleven focused tools, backed by the same SQLite ledger and capability manifest as the app.</p></div>
          <span>{config?.tools?.length ?? 11} tools</span>
        </div>
        <div className="tool-list">
          {[
            ["list_models", "Discover current image and video models by output and accepted input."],
            ["get_model_capabilities", "Inspect exact media fields, limits, and verification evidence."],
            ["upload_media", "Archive a local file and prepare its fal-hosted input URL."],
            ["create_media", "Generate with precise model parameters and mapped input assets."],
            ["list_results", "Read recent outputs with both local and hosted URLs."],
            ["get_usage", "Review billed spend and local archive health."],
            ["sync_models", "Check fal for newly published endpoints."],
            ["create_website", "Start a complete local website build from a creative brief."],
            ["create_document", "Create an editable, print-ready PDF edition."],
            ["list_projects", "Browse local website and document projects."],
            ["get_project", "Check live build progress and retrieve artifacts."],
          ].map(([name, description]) => (
            <article key={name}><code>{name}</code><p>{description}</p></article>
          ))}
        </div>
      </section>

      <section className="tool-list-section">
        <div className="tool-list-head">
          <div>
            <h2>Kie price sources</h2>
            <p>Kie has no live pricing API, so these numbers are hand-checked. Use the link to verify the current price before trusting a quote.</p>
          </div>
          <span>{kiePricing?.length ?? 0} models</span>
        </div>
        <table className="kie-pricing-table">
          <thead>
            <tr>
              <th>Kie model</th>
              <th>fal equivalents</th>
              <th>Current basis</th>
              <th>Last verified</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {(kiePricing ?? []).map((row) => (
              <tr key={row.kie_model}>
                <td><code>{row.kie_model}</code></td>
                <td>{row.fal_equivalents.length ? row.fal_equivalents.map((id) => <code key={id}>{id}</code>) : <span className="muted">none mapped</span>}</td>
                <td>{row.basis}</td>
                <td>
                  {row.last_verified ? (
                    <span title={row.verified_via}>{row.last_verified}</span>
                  ) : (
                    <span className="price-unverified-row">never verified</span>
                  )}
                </td>
                <td>
                  {row.source_url ? (
                    <a href={row.source_url} target="_blank" rel="noreferrer">check price</a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="tool-list-section">
        <div className="tool-list-head">
          <div>
            <h2>HeyGen price sources</h2>
            <p>HeyGen bills per second from a prepaid USD wallet, not a per-model API price — these rates are hand-checked against HeyGen's published pricing docs. Use the link to verify the current rate before trusting a quote.</p>
          </div>
          <span>{heygenPricing?.length ?? 0} tiers</span>
        </div>
        <table className="kie-pricing-table">
          <thead>
            <tr>
              <th>HeyGen tier</th>
              <th>fal equivalents</th>
              <th>Current basis</th>
              <th>Last verified</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {(heygenPricing ?? []).map((row) => (
              <tr key={row.heygen_model}>
                <td><code>{row.heygen_model}</code></td>
                <td>{row.fal_equivalents.length ? row.fal_equivalents.map((id) => <code key={id}>{id}</code>) : <span className="muted">none mapped</span>}</td>
                <td>{row.basis}</td>
                <td>
                  {row.last_verified ? (
                    <span title={row.verified_via}>{row.last_verified}</span>
                  ) : (
                    <span className="price-unverified-row">never verified</span>
                  )}
                </td>
                <td>
                  {row.source_url ? (
                    <a href={row.source_url} target="_blank" rel="noreferrer">check price</a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}
