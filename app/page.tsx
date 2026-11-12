import Link from "next/link";
import { EXPERIENCES, formatUsd } from "@/lib/catalog";

export default function Home() {
  return (
    <>
      <section className="hero">
        <h1>Book a small-group experience</h1>
        <p>
          Pick an experience, choose a date and pay with PayPal. This site was built with an AI coding tool; its
          checkout only went live after an automated gate attacked it in the PayPal sandbox and checked PayPal&apos;s
          records.
        </p>
      </section>
      <section className="grid">
        {EXPERIENCES.map((e) => (
          <article key={e.id} className="card">
            <h2>{e.title}</h2>
            <p className="meta">
              {e.location} · {e.duration}
            </p>
            <p>{e.blurb}</p>
            <p className="price">{formatUsd(e.amount)}</p>
            <Link className="button" href={`/experiences/${e.id}`}>
              Book this
            </Link>
          </article>
        ))}
      </section>
    </>
  );
}
