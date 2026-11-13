import { Hammer } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';

/** Tela de módulo ainda em desenvolvimento. */
export function StagePending({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <CardBody className="flex flex-col items-center py-14 text-center">
          <div className="mb-4 rounded-full bg-gold-50 p-4"><Hammer className="h-6 w-6 text-gold-500" /></div>
          <p className="font-display text-2xl text-navy">Em desenvolvimento</p>
          <p className="mt-2 max-w-md text-sm text-navy/55">{description}</p>
        </CardBody>
      </Card>
    </>
  );
}
