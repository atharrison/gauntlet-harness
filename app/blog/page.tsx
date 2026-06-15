import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'After Fired Festival | PR Review Harness',
  description:
    'A first-place finish at the Fired Festival AI hackathon, and what it meant.',
}

export default function BlogPage() {
  return (
    <article className="mx-auto max-w-2xl py-12">
      {/* Back link */}
      <Link
        href="/"
        className="mb-10 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-300"
      >
        ← back to harness
      </Link>

      {/* Header */}
      <header className="mb-10 mt-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-indigo-400">
          <a
            href="https://www.linkedin.com/posts/the-tech-job-market-has-been-genuinely-hard-ugcPost-7465106077806706688-IEhq/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            Fired Festival
          </a>{' '}
          · Hackathon Recap
        </p>
        <h1 className="mb-4 text-4xl font-bold leading-tight tracking-tight text-white">
          After Fired Festival
        </h1>
        <p className="text-sm text-gray-500">Sunday, June 14, 2026</p>
      </header>

      <hr className="mb-10 border-gray-800" />

      {/* Body — your words, untouched */}
      <div className="prose prose-invert prose-lg max-w-none space-y-6 text-gray-300 leading-relaxed">
        <p className="text-xl text-gray-200 leading-relaxed">
          1 year ago I&apos;d never heard of Cursor.
        </p>
        <p className="text-xl text-gray-200 leading-relaxed">
          2 weeks ago, I signed up for an AI hackathon.
        </p>
        <p className="text-xl text-gray-200 leading-relaxed">
          3 days ago, I nearly gave up my spot, with imposter syndrome creeping
          in.
        </p>
        <p className="text-xl text-gray-200 leading-relaxed">
          Today I&apos;m back home, staring a bit in disbelief at the Mac Mini
          sitting on my desk, a first place prize for my time and efforts.
        </p>
        <p>
          I wasn&apos;t sure what I was getting into — I&apos;d never heard of
          Gauntlet AI before, but their flyer piqued my attention. The software
          industry is changing faster than ever, and I wanted to know how
          engineers and companies are staying relevant and keeping up in this
          high-stakes move to AI.
        </p>
        <p>
          The 2-day event was advertised as a mix of AI talks interspersed
          throughout a 24-hour hackathon. Doors opened 7pm Friday with checkin
          and catered fajitas as 100 of us &ldquo;Challengers&rdquo; began to
          mingle and get our bearings. Our hack focus was announced around
          8:30pm: &ldquo;build an agentic harness&rdquo;. The guidelines were
          clear, but the application was wide-open. Your harness could focus on
          guiding, solving, or researching practically anything.
        </p>
        <p>
          The first presentation was about &ldquo;What is an agentic
          harness?&rdquo;. Halfway through, I settled on my focus: I&apos;d
          build something that, regardless of the outcome, would solve a
          pain-point I currently have: reviewing code.
        </p>
        <blockquote className="border-l-2 border-indigo-500 pl-5 my-6">
          <p className="text-lg italic text-indigo-300 leading-relaxed">
            &ldquo;I&apos;d build something that, regardless of the outcome, would
            solve a pain-point I currently have: reviewing code.&rdquo;
          </p>
        </blockquote>
        <p>
          I saw the writing on the wall 9 months ago, when I really started
          using Cursor and AI-assisted development. The amount of code I was
          able to produce in such a short amount of time could swamp my team
          with code review tasks. And once everyone was using it, the problem
          would compound. Last sprint, there were days when the only thing I
          accomplished was reviewing a stack of pull requests.
        </p>
        <p>
          11:30pm Friday evening, the only required deliverable was an
          architecture document — a one page PDF describing what we would be
          building. We broke into groups of 4–5 developers, defended our
          architecture, and let our fellow Challengers poke holes in it,
          constructively, building each other up and giving each of us the peer
          feedback greatly needed and appreciated, before we dove in.
        </p>
        <p>
          I returned 8am Saturday morning, rested and ready. My hack focused on
          building a harness that could streamline the PR Review process, with
          lofty goals of multi-agent fanout, a human-in-the-loop curation step,
          and a self-learning feedback loop, storing history and incorporating
          context that could be used to feed into the next review.
        </p>
        <p>
          What I delivered was solid, but ultimately fairly straightforward, and
          compared to many of the other projects was honestly a bit
          &ldquo;boring&rdquo;. But it worked. There was a moment, about 1pm on
          Saturday, where I was pushing PRs for the project, and then feeding
          the PR back into the harness, using this new PR review harness to
          review the next PR that was building the harness. It was the ultimate
          dog-fooding moment, and the flywheel I had built was proving itself in
          realtime.
        </p>
        <blockquote className="border-l-2 border-indigo-500 pl-5 my-6">
          <p className="text-lg italic text-indigo-300 leading-relaxed">
            &ldquo;It was the ultimate dog-fooding moment, and the flywheel I had
            built was proving itself in realtime.&rdquo;
          </p>
        </blockquote>
        <p>
          Lunch consisted of a quick salad/sandwich in one hand, while balancing
          a laptop in the other, screen open, prodding the AI along as I ate. By
          3:30pm, I had to be wrapping up features and thinking about how I
          would demo what I had built. I had one more feature to incorporate (a
          &ldquo;quick mode&rdquo;), and instead of fully building it first, I
          decided it was a perfect PR to demonstrate the harness.
        </p>
        <p>
          I fired up Zoom, filmed the demo in one-shot, uploaded the 5 min
          result to the submission site, and closed the laptop. 4:05pm… Then I
          opened it back up, spent a few minutes feeding the PR review results
          back into Cursor, and wrapped up the last feature before the 4:30pm
          deadline.
        </p>
        <p>
          They fed us dinner and we mingled as the judges deliberated. The
          third- and second-place prizes were announced, with very interesting,
          impressive projects. As for my project, regardless of the result, I
          knew I was taking home something I could use when Monday rolled around
          and the PR queue started building up again.
        </p>
        <p>
          Byron called my name and my jaw dropped. Austen was handed the mic,
          spoke briefly about what I had built, and then proceeded to describe
          how the judges had fed their own PRs into the tool, pitting the
          results against their own AI-assisted reviews, impressed at the
          quality this tool produced.
        </p>
        <p>
          I&apos;m not one for spotlights, so I was a bit out of my element as I
          accepted the prize, shook hands with the event organizers and fellow
          Challengers, posed for photos, and stepped aside for an interview. The
          blur of conversations were appreciated, and hope to keep in touch with
          those I met. Organizers and Challengers alike, Gauntlet AI have put
          together an incredible community, and I can&apos;t wait to see where
          it carries the industry.
        </p>
        <p>
          Sooner than I expected, they were shuffling us out the door, and I
          found myself walking back to the parking garage, a new Mac Mini in my
          backpack. But more importantly, a new experience under my belt, and
          new learnings to sit on and incorporate. The software industry is
          changing fast, and it is up to you to stay ahead of this wave. But
          maybe it&apos;s not so different from any other software phase-shift.
          The new abstraction is that we can now essentially write software in
          English, and do it at near the speed of thought.
        </p>
        <blockquote className="border-l-2 border-indigo-500 pl-5 my-6">
          <p className="text-lg italic text-indigo-300 leading-relaxed">
            &ldquo;The new abstraction is that we can now essentially write
            software in English, and do it at near the speed of thought.&rdquo;
          </p>
        </blockquote>
        <p>
          What stays constant are the fundamentals. Thoughtful design, clear
          requirements, and well thought out architecture are going to be even
          more important, and those who have a solid handle on these
          fundamentals are going to be just fine.
        </p>
      </div>

      <hr className="my-10 border-gray-800" />

      {/* Acknowledgements */}
      <section className="my-10">
        <h2 className="mb-5 text-lg font-semibold text-white">
          Acknowledgements
        </h2>
        <ul className="space-y-3 text-sm leading-relaxed text-gray-400">
          <li>
            Byron, Drew, Rebecca, and the rest of the team at{' '}
            <a
              href="https://gauntletai.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
            >
              Gauntlet AI
            </a>{' '}
            for organizing such a great event.
          </li>
          <li>
            <a
              href="https://www.linkedin.com/posts/gauntletai_firedfestival-gauntletai-aiengineering-activity-7468396315501051904-DJNe"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
            >
              Austen, Matthew, and Vivek
            </a>
            , for all your time and effort pouring through our submissions.
          </li>
          <li>
            Fellow Challengers, for showing up, buckling down, and helping build
            this community.
          </li>
        </ul>
      </section>

      <hr className="my-10 border-gray-800" />

      {/* Footer callout */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
        <p className="mb-2 text-sm font-semibold text-white">
          The harness built at Fired Festival
        </p>
        <p className="mb-4 text-sm text-gray-400">
          Multi-agent PR review with human-in-the-loop curation, guardrails, and
          a self-learning feedback loop.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            Try the harness
          </Link>
          <Link
            href="/architecture"
            className="rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 transition hover:border-gray-500 hover:text-white"
          >
            See the architecture
          </Link>
        </div>
      </div>
      {/* Easter egg */}
      <p className="mt-16 text-center text-xs text-gray-700">
        if you made it this far — the access code is &ldquo;Challenger&rdquo;,
        but swap in 3&apos;s where it makes sense.
      </p>
    </article>
  )
}
