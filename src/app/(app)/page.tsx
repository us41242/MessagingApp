import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
      <div className="text-center">
        <h2 className="text-lg font-medium tracking-tight">Pick a conversation</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Or{" "}
          <Link href="/new" className="underline">
            start a new one
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
