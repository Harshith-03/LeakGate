import { Compass, Radio } from "lucide-react";
import { ButtonLink, EmptyState } from "../components/ui";

export default function NotFound() {
  return (
    <div className="pt-6 sm:pt-12">
      <EmptyState title="Page not found" icon={<Compass size={20} />}>
        That address isn't part of LeakGate.
        <div className="mt-5 flex justify-center">
          <ButtonLink to="/" variant="primary" icon={<Radio size={15} />}>Back to Live</ButtonLink>
        </div>
      </EmptyState>
    </div>
  );
}
