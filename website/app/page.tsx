const proof = [
  ["Fail-closed", "governed execution"],
  ["0", "runtime dependencies"],
  ["2", "MCP provider shapes proven"],
];

const flow = [
  { mark: "01", label: "Validate", detail: "Contracts, authority, capability, budget" },
  { mark: "02", label: "Compile", detail: "One deterministic workflow identity" },
  { mark: "03", label: "Execute", detail: "Bounded specialists through MCP adapters" },
  { mark: "04", label: "Continue", detail: "Continuous run; heartbeat monitors and recovers" },
];

const failures = [
  ["Lost context", "Project memory is versioned data, not whatever still fits in a chat window."],
  ["Loose authority", "Every specialist is filtered by capability and allowed actions before assignment."],
  ["Brittle handoffs", "Inputs and outputs cross named, fingerprinted contracts or fail closed."],
  ["Stopped after status", "A progress report is not terminal. Safe work continues in the active run; heartbeat only monitors and recovers."],
];

export default function Home() {
  return (
    <main>
      <nav className="nav" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="Bounded Agent Harness home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>Bounded Agent Harness</span>
        </a>
        <div className="nav-links">
          <a href="#how">How it works</a>
          <a href="https://github.com/cexplayer01/bounded-agent-harness">GitHub</a>
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span /> Open-source agent infrastructure · v0.1.0</p>
          <h1>Agents move fast.<br /><em>The workflow should hold.</em></h1>
          <p className="lede">
            A deterministic control plane for multi-agent work: versioned memory,
            contract-checked handoffs, narrow authority, bounded cost, and recovery
            you can inspect.
          </p>
          <div className="actions">
            <a className="button primary" href="https://github.com/cexplayer01/bounded-agent-harness">
              View the code <span aria-hidden="true">↗</span>
            </a>
            <a className="button secondary" href="#proof">See the proof</a>
          </div>
          <p className="license-line">AGPL community edition · Commercial licensing available</p>
        </div>

        <div className="control-card" aria-label="Example compiled workflow">
          <div className="card-top">
            <span>workflow / review-release</span>
            <span className="verified">verified</span>
          </div>
          <div className="digest">sha256:7bf9…a214</div>
          <div className="nodes">
            <div className="node active"><b>plan.validate</b><small>contracts · authority · cost</small></div>
            <div className="rail"><span /></div>
            <div className="node"><b>specialist.review</b><small>mcp · bounded context</small></div>
            <div className="rail"><span /></div>
            <div className="node"><b>artifact.accept</b><small>evidence · checkpoint</small></div>
          </div>
          <div className="card-foot">
            <span><i className="pulse" /> continuous run active</span>
            <span>cost 5 / 8 units</span>
          </div>
        </div>
      </section>

      <section className="proof" id="proof" aria-label="Current prototype proof">
        <p>Runnable today, described honestly.</p>
        <div className="proof-grid">
          {proof.map(([value, label]) => (
            <div key={label}><strong>{value}</strong><span>{label}</span></div>
          ))}
        </div>
        <a href="https://github.com/cexplayer01/bounded-agent-harness#current-runnable-slice">Inspect the runnable slice ↗</a>
      </section>

      <section className="how" id="how">
        <div className="section-heading">
          <p className="eyebrow">The control loop</p>
          <h2>Less agent theater.<br />More operational truth.</h2>
        </div>
        <ol className="flow">
          {flow.map((item) => (
            <li key={item.mark}>
              <span>{item.mark}</span>
              <div><h3>{item.label}</h3><p>{item.detail}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="failure-section">
        <div className="section-heading">
          <p className="eyebrow">Built for the failure around the model</p>
          <h2>Models are capable.<br />Operations are fragile.</h2>
          <p className="section-copy">Bounded Agent Harness does not replace your models or tools. It gives them a smaller, inspectable surface to work inside.</p>
        </div>
        <div className="failure-grid">
          {failures.map(([title, detail], index) => (
            <article key={title}>
              <span>0{index + 1}</span>
              <h3>{title}</h3>
              <p>{detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="honest-section">
        <div className="honest-copy">
          <p className="eyebrow">What exists now</p>
          <h2>A working control-plane foundation—not a production claim.</h2>
          <p>Version 0.1.0 compiles, runs, resumes, inspects, and rejects unsafe local workflows. It includes contract-bound memory, evidence, cost enforcement, approval gates, specialist routing, an in-process MCP compatibility proof, and an explicit work-loop policy that keeps continuous execution separate from heartbeat recovery.</p>
          <div className="inline-actions">
            <a href="https://github.com/cexplayer01/bounded-agent-harness#current-runnable-slice">Run the five-minute demo ↗</a>
            <a href="https://github.com/cexplayer01/bounded-agent-harness/blob/main/THREAT-MODEL.md">Read the threat model ↗</a>
          </div>
        </div>
        <div className="boundary-card">
          <p>Not claimed yet</p>
          <ul>
            <li>Production-ready hosted service</li>
            <li>Cryptographic provider authentication</li>
            <li>Real-provider compatibility proof</li>
            <li>General autonomous-agent framework</li>
          </ul>
          <span>Those boundaries are deliberate and documented.</span>
        </div>
      </section>

      <section className="commercial" id="commercial">
        <p className="eyebrow">Open community. Sustainable development.</p>
        <h2>Use it openly.<br />Pay when you need private rights or focused help.</h2>
        <div className="commercial-grid">
          <article>
            <span>Community</span>
            <h3>AGPL-3.0-or-later</h3>
            <p>Inspect, modify, run, and build open systems under the community license.</p>
            <a href="https://github.com/cexplayer01/bounded-agent-harness">Get the code ↗</a>
          </article>
          <article className="featured">
            <span>Founding design partner</span>
            <h3>Bring one brittle workflow.</h3>
            <p>Explore a tightly scoped integration, compatibility review, and verified control plan.</p>
            <a href="https://github.com/cexplayer01/bounded-agent-harness/issues/new?title=Founding%20design%20partner%20inquiry">Start an inquiry ↗</a>
          </article>
          <article>
            <span>Commercial</span>
            <h3>Different rights, clear terms.</h3>
            <p>For proprietary embedding, closed modified services, support, or future managed infrastructure.</p>
            <a href="https://github.com/cexplayer01/bounded-agent-harness/blob/main/COMMERCIAL-LICENSING.md">Licensing path ↗</a>
          </article>
        </div>
      </section>

      <section className="support" id="support">
        <div>
          <p className="eyebrow">Keep the public work moving</p>
          <h2>If this saves you time, help fund the next verified release.</h2>
          <p>
            Tips support continued open development. They are appreciated, never
            required, and do not grant commercial-license rights.
          </p>
        </div>
        <div className="support-links" aria-label="Ways to support Bounded Agent Harness">
          <a href="https://venmo.com/code?user_id=2993836355747840416&created=1785187797" target="_blank" rel="noopener noreferrer">
            <span>Venmo</span><b>Open Venmo ↗</b>
          </a>
          <a href="https://cash.app/$thegemologist" target="_blank" rel="noopener noreferrer">
            <span>Cash App</span><b>$thegemologist ↗</b>
          </a>
          <a href="https://buymeacoffee.com/thegemologq" target="_blank" rel="noopener noreferrer">
            <span>Buy Me a Coffee</span><b>thegemologq ↗</b>
          </a>
          <a href="https://www.paypal.com/us/digital-wallet/send-receive-money/send-money" target="_blank" rel="noopener noreferrer">
            <span>PayPal</span><b>vandaelewatch@gmail.com ↗</b>
          </a>
        </div>
      </section>

      <footer>
        <a className="brand" href="#top"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>Bounded Agent Harness</span></a>
        <p>Compile. Constrain. Recover.</p>
        <div><a href="https://github.com/cexplayer01/bounded-agent-harness">GitHub</a><a href="https://github.com/cexplayer01/bounded-agent-harness/blob/main/LICENSE">AGPL license</a></div>
      </footer>
    </main>
  );
}
