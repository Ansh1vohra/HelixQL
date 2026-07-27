import { NavBar } from "@/components/marketing/NavBar";
import { Footer } from "@/components/marketing/Footer";
import { Hero } from "@/components/marketing/Hero";
import { TechStack } from "@/components/marketing/TechStack";
import { Features } from "@/components/marketing/Features";
import { HowItWorksJourney } from "@/components/marketing/HowItWorksJourney";
import { SecurityDeepDive } from "@/components/marketing/SecurityDeepDive";
import { HomeFaq } from "@/components/marketing/HomeFaq";
import { FinalCta } from "@/components/marketing/FinalCta";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <NavBar />
      <main>
        <Hero />
        <TechStack />
        <Features />
        <HowItWorksJourney />
        <SecurityDeepDive />
        <HomeFaq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
