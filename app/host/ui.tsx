import { useState } from "react";
import { CheckIcon } from "../check-icon";

export function HostShell({
  header,
  footer,
  children,
}: {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col gap-10 bg-stone-950 px-16 py-10 text-white">
      {header && <header className="flex items-center justify-between gap-8">{header}</header>}
      {children}
      {footer && <footer className="flex items-center justify-end gap-8">{footer}</footer>}
    </main>
  );
}

// "md" is for the act screens, where the scene band needs the space.
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: "lg" | "md" };

export function BigButton({ size = "lg", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`bg-amber-400 font-semibold text-stone-950 transition-opacity disabled:opacity-30 ${
        size === "md" ? "rounded-xl px-8 py-3 text-2xl" : "rounded-2xl px-12 py-6 text-4xl"
      }`}
    />
  );
}

export function SecondaryButton({ size = "lg", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`border-2 border-stone-600 font-semibold text-white transition-opacity disabled:opacity-30 ${
        size === "md" ? "rounded-xl px-6 py-3 text-2xl" : "rounded-2xl px-10 py-6 text-3xl"
      }`}
    />
  );
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-2xl text-red-400">{error}</p>;
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-2xl font-medium uppercase tracking-widest text-amber-400">{children}</p>
  );
}

export function SubmissionChip({ name, done }: { name: string; done: boolean }) {
  return (
    <li
      className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xl font-medium ${
        done ? "bg-emerald-500 text-stone-950" : "border-2 border-stone-700 text-stone-500"
      }`}
    >
      {done && <CheckIcon className="h-5 w-5" />}
      {name}
    </li>
  );
}

// The act's animated scene, in a band across the top of the shared screen: a
// muted looping video, or a still image. Until the file exists, a dark
// placeholder keeps the layout the same (and names the missing file in dev).
export function SceneBand({ src, label }: { src: string; label: string }) {
  const [missing, setMissing] = useState(false);
  const isImage = /\.(jpe?g|png|webp|avif|gif)$/i.test(src);

  return (
    // Takes all the screen's spare space, and never less than 30% of its height.
    <div className="relative min-h-[30vh] grow basis-0 overflow-hidden rounded-3xl bg-linear-to-b from-stone-800 to-stone-900">
      {!missing &&
        (isImage ? (
          <div
            role="img"
            aria-label={label}
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${src})` }}
          />
        ) : (
          <video
            src={src}
            autoPlay
            muted
            loop
            playsInline
            aria-label={label}
            onError={() => setMissing(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ))}
      {missing && process.env.NODE_ENV === "development" && (
        <p className="absolute inset-0 flex items-center justify-center text-xl text-stone-500">
          Scene goes here: public{src}
        </p>
      )}
      {/* Fades the bottom edge into the page so the text below reads as part of the scene. */}
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-stone-950/80 to-transparent" />
    </div>
  );
}
