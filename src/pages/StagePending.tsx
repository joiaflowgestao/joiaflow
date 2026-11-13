import { Hammer } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';

/**
 * Marcador TEMPORÁRIO de desenvolvimento por etapas.
 * Cada página é substituída pela implementação real na etapa indicada.
 * Não vai para produção: a Etapa 10 verifica que nenhuma rota usa este componente.
 */
export function StagePending({ title, stage, description }: { title: string; stage: number; description: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <CardBody className="flex flex-col items-center py-14 text-center">
          <div className="mb-4 rounded-full bg-gold-50 p-4"><Hammer className="h-6 w-6 text-gold-500" /></div>
          <p className="font-display text-2xl text-navy">Em desenvolvimento — Etapa {stage}</p>
          <p className="mt-2 max-w-md text-sm text-navy/55">{description}</p>
        </CardBody>
      </Card>
    </>
  );
}
