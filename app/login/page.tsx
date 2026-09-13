import { FileText, LockKeyhole } from "lucide-react";
import { getAppAuthConfigStatus } from "@/lib/simple-auth";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const config = getAppAuthConfigStatus();
  const nextPath = sanitizeNextPath(params.next);

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section className="w-full max-w-sm rounded-lg border border-line bg-white p-6 shadow-panel">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-slate-100 text-ink">
            <FileText size={20} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Invoice to FIC</p>
            <h1 className="text-xl font-semibold">Accesso protetto</h1>
          </div>
        </div>

        <form action="/api/auth/login" method="post" className="space-y-4">
          <input type="hidden" name="next" value={nextPath} />
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                autoComplete="current-password"
                autoFocus
                className="h-11 w-full rounded-md border border-line pl-10 pr-3 outline-none focus:border-ink"
                disabled={!config.configured}
                name="password"
                type="password"
              />
            </div>
          </label>

          {params.error === "invalid" ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Password non corretta.
            </p>
          ) : null}

          {!config.configured ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Configura prima {config.missing.join(", ")} su Vercel.
            </p>
          ) : null}

          <button
            className="inline-flex h-11 w-full items-center justify-center rounded-md bg-ink px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={!config.configured}
            type="submit"
          >
            Entra
          </button>
        </form>
      </section>
    </main>
  );
}

function sanitizeNextPath(value?: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}
