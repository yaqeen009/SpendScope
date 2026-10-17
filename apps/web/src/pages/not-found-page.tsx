import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';

export function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass className="size-8" />}
      title="Page not found"
      description="That page does not exist. Use the navigation to get back to your dashboard."
      action={
        <Button asChild>
          <Link to="/">Back to overview</Link>
        </Button>
      }
    />
  );
}
