import { useStore } from "../store";

const IMG = `${import.meta.env.BASE_URL}about/`;

type Photo = { src: string; alt: string; caption: string; credit: string; license: string; licenseUrl: string; page: string };

// Openly licensed photos from Wikimedia Commons. Project Kilby isn't built yet, so these show the same kind of equipment.
const PHOTOS: Photo[] = [
  {
    src: "turbine.jpg", alt: "A technician in a hard hat measuring the blades inside a huge gas turbine",
    caption: "Inside a large gas turbine. Kilby will run many machines like this, mostly from GE Vernova.",
    credit: "Siemens press picture", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    page: "https://commons.wikimedia.org/wiki/File:Gasturbine_Montage01.jpg",
  },
  {
    src: "gas-plant.jpg", alt: "A natural gas power plant with two tall exhaust stacks under a blue Texas sky",
    caption: "A natural gas power plant in Texas (Bastrop Energy Center). Kilby will be a much larger plant of this kind.",
    credit: "Larry D. Moore", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    page: "https://commons.wikimedia.org/wiki/File:Bastrop_Energy_Center_Bastrop_County_Texas_2026.jpg",
  },
  {
    src: "permian.jpg", alt: "An oil pumpjack on flat desert land in the Permian Basin",
    caption: "The Permian Basin in West Texas, where the plant's natural gas comes from.",
    credit: "Quintin Soloviev", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    page: "https://commons.wikimedia.org/wiki/File:Oil_pumpjack_in_the_Permian_Basin.jpg",
  },
  {
    src: "data-center.jpg", alt: "Rows of computer servers lit with blue lights inside a data center",
    caption: "A data center: rooms full of computers. AI data centers like Microsoft's use enormous amounts of electricity.",
    credit: "BalticServers.com", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    page: "https://commons.wikimedia.org/wiki/File:BalticServers_data_center.jpg",
  },
];

const SOURCES = [
  { title: "Chevron signs 20-year power agreement with Microsoft for West Texas data center", where: "Chevron newsroom (official announcement), June 22, 2026", url: "https://www.chevron.com/newsroom/2026/q2/chevron-signs-20-year-power-agreement-with-microsoft-for-west-texas-data-center" },
  { title: "Same announcement on Business Wire", where: "Business Wire, June 22, 2026", url: "https://www.businesswire.com/news/home/20260622017964/en/Chevron-Signs-20-Year-Power-Agreement-with-Microsoft-for-West-Texas-Data-Center" },
  { title: "Project Kilby: Chevron and Microsoft partner on 2.67 GW West Texas power plant", where: "BIC Magazine", url: "https://www.bicmagazine.com/industry/powergen/chevron-signs-power-agreement-microsoft/" },
  { title: "Chevron signs 20-year Microsoft power deal for West Texas AI project", where: "World Oil", url: "https://worldoil.com/news/2026/6/22/chevron-signs-20-year-microsoft-power-deal-for-west-texas-ai-project/" },
];

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

function Figure({ p, wide }: { p: Photo; wide?: boolean }) {
  return (
    <figure className={`ab-fig ${wide ? "is-wide" : ""}`}>
      <img src={IMG + p.src} alt={p.alt} loading="lazy" decoding="async" />
      <figcaption>
        {p.caption}
        <small>Photo: <Ext href={p.page}>{p.credit}</Ext>, <Ext href={p.licenseUrl}>{p.license}</Ext></small>
      </figcaption>
    </figure>
  );
}

export function AboutView() {
  const setView = useStore((s) => s.setView);
  return (
    <div className="about">
      <article className="ab-body">
        <header className="ab-hero">
          <p className="ab-kicker">About this project</p>
          <h2>Keeping the lights on for an AI data center</h2>
          <p className="ab-lead">
            Chevron is planning a huge natural gas power plant in West Texas, called <strong>Project Kilby</strong>. It will be built right next to a
            Microsoft data center and power it directly. Power Guard 360 is our working model of a plant like that: a live control room you can
            watch in your browser, which spots trouble before it turns into a blackout.
          </p>
        </header>

        <Figure p={PHOTOS[1]} wide />

        <section className="ab-sec">
          <h3>The news in one minute</h3>
          <dl className="ab-facts">
            <div><dt>What was signed</dt><dd>A <strong>20-year agreement</strong>: Microsoft will buy the electricity from this plant for 20 years. Signed by Energy Forge One, a Chevron company, and announced on <strong>June 22, 2026</strong>.</dd></div>
            <div><dt>Who is involved</dt><dd>Chevron builds and runs the plant, together with the investment firm Engine No. 1. Microsoft runs the data center and uses the power.</dd></div>
            <div><dt>Where</dt><dd>West Texas, using natural gas from the Permian Basin, one of the biggest oil and gas regions in the country.</dd></div>
            <div><dt>How big</dt><dd>About <strong>2.67 gigawatts</strong>. One gigawatt is roughly what one large nuclear reactor makes, so this is among the largest projects of its kind in the U.S. It will be built in stages.</dd></div>
            <div><dt>The machines</dt><dd>Mostly large gas turbines from GE Vernova, plus smaller ones from Solar Turbines (part of Caterpillar). A gas turbine works like a jet engine bolted to the ground that spins a generator.</dd></div>
            <div><dt>When</dt><dd>Chevron expects to give the final go-ahead by the end of 2026. The first electricity is expected in <strong>2028</strong>.</dd></div>
            <div><dt>For the area</dt><dd>Almost 2,000 jobs and more than $10 billion in state and local taxes, according to Chevron. It plans to use salty groundwater instead of drinking water, and equipment that cuts smog-forming exhaust.</dd></div>
          </dl>
          <p className="ab-note">
            The contract itself is private. What's public is the official announcement, linked under{" "}
            <button type="button" className="link" onClick={() => document.getElementById("ab-sources")?.scrollIntoView({ behavior: "smooth" })}>Read the original news</button>.
          </p>
        </section>

        <section className="ab-sec">
          <h3>Why this is hard</h3>
          <div className="ab-cols">
            <p>
              <strong>The data center depends on its own power plant.</strong> It gets its electricity straight from the turbines next door instead of the public
              grid, which keeps it from straining the grid that homes rely on. But it means these turbines have to keep up: if too many stop at once, the computers go dark.
            </p>
            <p>
              <strong>AI computers swing their power use fast.</strong> When thousands of AI chips start or finish a job together, the power they need can jump
              or drop in seconds. Turbines prefer steady work, and those sudden swings wear them out faster.
            </p>
            <p>
              <strong>Breakdowns are expensive.</strong> A turbine that fails without warning means lost computing time and costly repairs. Spotting the
              warning signs early, and sending an engineer before it breaks, saves both.
            </p>
          </div>
        </section>

        <div className="ab-pair">
          <Figure p={PHOTOS[0]} />
          <Figure p={PHOTOS[3]} />
        </div>

        <section className="ab-sec">
          <h3>What we built, and why</h3>
          <p>
            We wanted to show what the control room for a plant like Kilby could look like, and how computers can help the people running it.
            Power Guard 360 has eight gas turbines feeding an AI data center, a big battery, and a link to the outside grid for emergencies.
          </p>
          <ul className="ab-list">
            <li><strong>A live 3D copy of the plant.</strong> The <button type="button" className="link" onClick={() => setView("twin")}>Plant</button> page shows every turbine and what it's doing right now. Click any part to see its readings.</li>
            <li><strong>Early warnings.</strong> A machine learning model, trained on a public dataset of machine failures, reads each turbine's temperature, speed, turning force and wear. It predicts which one is likely to break and roughly when.</li>
            <li><strong>Repairs before breakdowns.</strong> When the model sees trouble coming, it suggests sending an engineer. The manager approves, and the <button type="button" className="link" onClick={() => setView("maintenance")}>Maintenance</button> page tracks the job until it's fixed.</li>
            <li><strong>The battery fills the gaps.</strong> If a turbine trips, the battery covers the shortfall for a few minutes while the other turbines speed up.</li>
            <li><strong>Ask questions in plain English.</strong> The Copilot (Google Gemini) answers questions like "what needs attention right now?" using the live numbers on screen.</li>
          </ul>
        </section>

        <section className="ab-sec">
          <h3>How to read the dashboard</h3>
          <dl className="ab-gloss">
            <div><dt>Demand</dt><dd>How much power the data center is using right now.</dd></div>
            <div><dt>Turbines</dt><dd>How much power the turbines are making.</dd></div>
            <div><dt>Reserve</dt><dd>Extra power the running turbines and the battery could add quickly if needed. More is safer.</dd></div>
            <div><dt>Battery / Battery charge</dt><dd>Power flowing out of the battery, and how full it is.</dd></div>
            <div><dt>Grid import</dt><dd>Power borrowed from the outside grid. Normally zero.</dd></div>
            <div><dt>Wear</dt><dd>How worn a turbine's parts are, in minutes of use. High wear means it's due for service.</dd></div>
            <div><dt>Trip</dt><dd>A turbine shutting itself off suddenly to protect itself.</dd></div>
          </dl>
        </section>

        <Figure p={PHOTOS[2]} wide />

        <section className="ab-sec" id="ab-sources">
          <h3>Read the original news</h3>
          <ul className="ab-sources">
            {SOURCES.map((s) => (
              <li key={s.url}><Ext href={s.url}>{s.title}</Ext><span>{s.where}</span></li>
            ))}
          </ul>
        </section>

        <p className="ab-disclaimer">
          Power Guard 360 is an independent student project. It is not made by, endorsed by or connected to Chevron, Microsoft, Engine No. 1 or GE Vernova.
          The plant on this site is a simulation: its readings come from the public AI4I 2020 machine-failure dataset, not from a real power plant.
        </p>
      </article>
    </div>
  );
}
