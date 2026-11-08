import { Compass, SquareTerminal } from "lucide-react";
import { ButtonLink, EmptyState } from "../components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl pt-6 sm:pt-12">
      <EmptyState title="Page not found" icon={<Compass size={20} />} plate="ERR 404">
        That address isn't part of LeakGate.
        <div className="mt-5 flex justify-center">
          <ButtonLink to="/" variant="primary" icon={<SquareTerminal size={15} />}>Back to the console</ButtonLink>
        </div>
      </EmptyState>
    </div>
  );
}
