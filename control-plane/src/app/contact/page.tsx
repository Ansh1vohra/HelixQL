import { NavBar } from "@/components/marketing/NavBar";
import { Footer } from "@/components/marketing/Footer";
import { ContactForm } from "./ContactForm";

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-white">
      <NavBar />
      <main className="mx-auto max-w-2xl px-6 py-20">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">Contact us</h1>
        <p className="mt-4 text-lg text-slate-500">
          Questions about a database connection, a query that won&apos;t validate, billing, or anything else —
          we&apos;d rather hear about it than have you stuck.
        </p>

        <div className="mt-10">
          <ContactForm />
        </div>
      </main>
      <Footer />
    </div>
  );
}
