import { notFound } from "next/navigation";
import BookForm from "@/components/BookForm";
import { findExperience, formatUsd } from "@/lib/catalog";

export default async function ExperiencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const exp = findExperience(id);
  if (!exp) notFound();
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  return (
    <div className="split">
      <article className="card">
        <h1 style={{ margin: 0 }}>{exp.title}</h1>
        <p className="meta">
          {exp.location} · {exp.duration}
        </p>
        <p>{exp.blurb}</p>
        <p className="price">{formatUsd(exp.amount)} per person</p>
      </article>
      <section className="card">
        <h2>Your booking</h2>
        <BookForm experienceId={exp.id} defaultDate={tomorrow} />
      </section>
    </div>
  );
}
