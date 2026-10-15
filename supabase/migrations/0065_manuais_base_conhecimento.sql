-- 0065 — Manuais do sistema por perfil na Base de conhecimento (tema "Manuais do sistema", um por área). Idempotente por id_externo.
-- Carga de conteúdo; reaplicar substitui o corpo (a versão anterior fica em conteudos_versoes).

insert into public.conteudos (area, tema, titulo, resumo, corpo_md, tags, ordem, origem, id_externo, publicado)
values ($md$geral$md$, $md$Manuais do sistema$md$, $md$Manual do sistema — o básico (todo mundo)$md$, $md$Entrar, Meu painel, tarefas (abrir, passar, concluir, horas), agenda, sino, chat, avisos — o que todo mundo precisa saber.$md$, $md$Endereço: https://nevespaduaadv.github.io/painel/ · Login: e-mail do escritório + senha (a primeira senha vem pelo convite; troque em **Meu perfil**). Cada pessoa só enxerga o que é da sua área.

## Entrar

Abra o endereço, use seu e-mail e senha. No celular funciona igual (pode "adicionar à tela inicial").

## Meu painel

É a sua tela inicial. Mostra:

- **Tarefas abertas / Atrasadas / Fatais em 7 dias** — só as suas.
- **Vence até 7 dias** e **Próximos 30 dias** — suas tarefas e prazos em ordem.
- **Calendário do mês** — bolinha em cada dia com quantas coisas você tem (vermelha = atraso ou prazo fatal; dourada = prazo; azul = compromisso). Clique no dia para ver a lista; **Agenda completa** abre a Agenda naquele mês.
- **Atividade recente** — o que mudou nas suas tarefas.
- Botão **Receber resumo agora** manda o resumo do dia no seu Discord.

## Tarefas e prazos

Tudo que você precisa fazer está aqui. Regras da casa:

- **Toda demanda vira tarefa.** Se alguém te pediu algo no corredor, crie a tarefa (**+ Tarefa**: título, cliente, responsável, prazo, prioridade; marque *prazo fatal* quando perder o prazo for irreversível).
- **Clique no título** da tarefa para abrir a tela dela. Lá estão os botões:
  - **▶ Em andamento** — avisa que você começou.
  - **→ Passar para…** — passa a tarefa para outra pessoa com um recado. A pessoa recebe no sino e no Discord; fica registrado no histórico quem passou, para quem e por quê.
  - **+ Lançar horas** — ao terminar um trabalho, lance as horas na própria tarefa. Quem executa, lança na hora.
  - **✓ Concluir** — pede "o que foi feito?" em uma linha. Tarefa concluída some do seu painel e entra no histórico do cliente.
- Use **Comentar** para registrar o andamento ("liguei para o cliente, aguardando documentos"). Isso vira histórico; ninguém precisa te perguntar. **Ctrl+Enter** envia.
- Digite **@** no comentário e escolha o nome para avisar alguém — a pessoa recebe no sino.
- Tarefa atrasada fica vermelha para você e para quem acompanha. Se o prazo mudou de verdade, altere o prazo em **Editar** e diga por quê no comentário.

## Agenda

Mês / Semana / Dia. Mostra seus prazos (tarefas, processos, negociações), seus compromissos (audiências, reuniões) e o que está no seu Google Calendar, se ligado. **+ Compromisso** cria audiência/reunião/perícia; vai para o Google da pessoa responsável. Feriado nacional aparece como folga; estadual/municipal/forense aparece como "trabalhamos, mas conta para prazo".

## Sino (🔔)

Avisos para você: tarefa nova, tarefa passada para você, menção, prazo, aviso da direção, compromisso em 1h. Clique para abrir o item.

## Chat (💬, ao lado do sino)

Canal **Geral** (todo o escritório — espelhado no Discord), canal da sua área, e conversas diretas (+). **@Nome** avisa a pessoa; **@todos** avisa o canal.

## Avisos

Mural da direção. Aviso novo aparece no seu painel e no sino; leia e clique **Marcar como lido**.

## Meu perfil

Foto, dados de contato, trocar senha, ver seus acessos. Quem registra ponto bate o ponto aqui.

## Busca (/)

Campo no topo: cliente, CNPJ, processo ou lead.

## Visão do cliente

A caixa no topo mostra o sistema como o cliente vê (o painel dele). Use para conferir antes de mandar algo ao cliente.

## Combinados

1. Toda demanda vira tarefa.
2. Registre no sistema, não no WhatsApp.
3. Horas na hora.
4. Terminou → Concluir.$md$, array[$md$manual$md$,$md$sistema$md$,$md$tarefas$md$]::text[], 1, 'manual', 'manual:basico', true)
on conflict (id_externo) where id_externo is not null do update
  set area=excluded.area, tema=excluded.tema, titulo=excluded.titulo, resumo=excluded.resumo, corpo_md=excluded.corpo_md, tags=excluded.tags, ordem=excluded.ordem, publicado=true;

insert into public.conteudos (area, tema, titulo, resumo, corpo_md, tags, ordem, origem, id_externo, publicado)
values ($md$juridico$md$, $md$Manuais do sistema$md$, $md$Manual — Jurídico$md$, $md$Rotina diária, ficha do cliente, processos e DJEN, negociações, régua de maturação, fluxo PJ, onboarding com entrada paga.$md$, $md$Leia antes o **Manual do sistema — o básico** (Base de conhecimento → Geral).

Você vê: Meu painel, Tarefas, Agenda, Avisos, Meu perfil, **Clientes**, **Jurídico** (Processos, Negociações, Revisional, Superendividamento, Modelos de peças, Monitoramento, Base de conhecimento, Autenticador 2FA) e o chat *Jurídico*.

## Rotina diária sugerida

1. Abra **Meu painel**: resolva primeiro *Atrasadas* e *Fatais*, depois *Vence até 7 dias*.
2. Veja o **sino** e o chat.
3. Ao longo do dia: trabalhe pela tarefa (Em andamento → comentário → horas → Concluir).
4. Antes de sair: olhe o calendário do dia seguinte.

## Clientes → ficha do cliente

Tudo do cliente em abas: dados, contratos (dívidas por banco), processos, negociações, fluxo PJ, onboarding, financeiro, timeline.

**Timeline** é o histórico do cliente: registre reuniões, contatos com o banco, protocolos. O que estiver marcado **visível para o cliente** aparece no painel dele — então escreva como se o cliente fosse ler.

Regra: **timeline** é o que aconteceu com o cliente; **tarefa** é o que alguém ainda precisa fazer.

## Processos

Lista com próximo prazo, responsável e fase. Abra o processo para andamentos e prazos.

**Publicações do DJEN** entram sozinhas: cada publicação vira um andamento e uma tarefa "Analisar publicação" (ou "Analisar N publicações", quando o mesmo processo tem várias no dia) com prazo no dia seguinte para o responsável do processo — por isso o responsável da ficha precisa estar certo. Em **Publicações**, o botão da tarefa abre direto a tela dela.

## Negociações (Acordos)

Quadro por etapa. Cada card tem banco, saldo cobrado, proposta, alçada autorizada, honorários de êxito e prazo. O sistema calcula o desembolso total e avisa em vermelho se passar da alçada. Ao registrar o acordo fechado, o sistema abre sozinho as tarefas de pós-acordo (depoimento/prova social e relatório de conclusão). Dentro de Negociações: **Base de acordos** (histórico do que fechamos).

## Régua de maturação (automática)

Aos 6 meses de atraso de um contrato, e nos 10º/11º/12º meses de contrato do cliente, o sistema abre uma tarefa prioridade 1 para quem cuida da negociação daquele cliente. Você não precisa vigiar — mas precisa executar a tarefa.

## Fluxo PJ (na ficha)

Etapas do cliente, régua Bronze/Prata/Ouro, *direcionamento* (Acordos / Jurídico / ambos) e a trava do Registrato na pasta.

## Onboarding do cliente PJ (na ficha)

O cliente recebe o formulário pelo WhatsApp na assinatura. A **R1 só é liberada depois da entrada paga**: quando o pagamento cai no Asaas, o sistema libera sozinho e manda o link da agenda. Se o pagamento foi por fora, abra a ficha → Onboarding → **Confirmar entrada e liberar R1**. Enquanto não houver entrada, o cliente vê "aguardando confirmação do pagamento" e existe uma tarefa "Onboarding: conferir pagamento da entrada" para o responsável.

## Revisional / Superendividamento / Modelos de peças

Ferramentas de análise e geração de peças em .docx com o timbrado. Gere, revise, salve na pasta do Drive do cliente.

## Monitoramento

Processos e CNPJs acompanhados; alerta de distribuição nova.

## Autenticador (2FA)

Códigos dos acessos a PJe/e-SAJ/gov.br compartilhados. Toda consulta fica registrada.

## Base de conhecimento → Jurídico

POPs, teses, modelos. Se descobriu algo que a equipe precisa saber, escreva um artigo (**+ Artigo**).

## O que não fazer

Tarefa sem cliente · trabalho sem tarefa · conversa de prazo pelo WhatsApp sem registrar no sistema · concluir tarefa sem lançar horas.$md$, array[$md$manual$md$,$md$sistema$md$,$md$juridico$md$]::text[], 2, 'manual', 'manual:juridico', true)
on conflict (id_externo) where id_externo is not null do update
  set area=excluded.area, tema=excluded.tema, titulo=excluded.titulo, resumo=excluded.resumo, corpo_md=excluded.corpo_md, tags=excluded.tags, ordem=excluded.ordem, publicado=true;

insert into public.conteudos (area, tema, titulo, resumo, corpo_md, tags, ordem, origem, id_externo, publicado)
values ($md$juridico$md$, $md$Manuais do sistema$md$, $md$Manual — Estagiário do jurídico (ponto)$md$, $md$O manual Jurídico mais o registro de ponto em Meu perfil.$md$, $md$Tudo do **Manual — Jurídico**, mais o **ponto**.

## Ponto

**Meu perfil → Ponto.**

- Ao chegar: **Entrada**.
- Intervalo: **Saída para intervalo** / **Volta**.
- Ao sair: **Saída**.

O sistema escolhe a próxima batida sozinho; se errar, fale com a administração (só ela ajusta).

Jornada padrão: 6h. O espelho do mês mostra as horas e o saldo do dia. Esqueceu de bater? Registre assim que lembrar e avise no comentário — não espere o fim do mês.$md$, array[$md$manual$md$,$md$sistema$md$,$md$ponto$md$,$md$estagiario$md$]::text[], 3, 'manual', 'manual:estagiario', true)
on conflict (id_externo) where id_externo is not null do update
  set area=excluded.area, tema=excluded.tema, titulo=excluded.titulo, resumo=excluded.resumo, corpo_md=excluded.corpo_md, tags=excluded.tags, ordem=excluded.ordem, publicado=true;

insert into public.conteudos (area, tema, titulo, resumo, corpo_md, tags, ordem, origem, id_externo, publicado)
values ($md$juridico$md$, $md$Manuais do sistema$md$, $md$Manual — Controladoria do jurídico$md$, $md$Visão de equipe: aba Jurídico do painel, filtro por responsável, DJEN, horas, ponto e rotina de controle.$md$, $md$Tudo do **Manual — Jurídico**, mais a **visão de equipe**.

## Onde olhar

- **Meu painel → aba Jurídico**: tarefas abertas/atrasadas/fatais de toda a equipe jurídica e atividade recente do setor. É a tela de cobrança de prazo.
- **Tarefas e prazos**: filtro por responsável; veja quem está com atraso e por quê (comentários e histórico da tarefa — inclusive se foi passada de uma pessoa para outra).
- **Publicações (DJEN)**: todas as publicações do escritório, se viraram tarefa e para quem.
- **Equipe → Horas**: horas lançadas por pessoa e por cliente, por semana. **Equipe → Ponto**: espelho dos estagiários e ajustes.
- **Gestão → Visão geral** (se liberado): carteira, prazos, produtividade por pessoa.

## Rotina sugerida de controle

- **Diária (10 min):** Meu painel → Jurídico → *Atrasadas* e *Fatais*. Cobre pelo comentário na tarefa com @Nome, não por WhatsApp.
- **Semanal:** horas por pessoa × tarefas concluídas; publicações sem tarefa; negociações paradas (sem movimento há 15 dias).
- **Mensal:** Visão geral; relatório mensal dos clientes (painel do cliente).$md$, array[$md$manual$md$,$md$sistema$md$,$md$controladoria$md$]::text[], 4, 'manual', 'manual:controladoria', true)
on conflict (id_externo) where id_externo is not null do update
  set area=excluded.area, tema=excluded.tema, titulo=excluded.titulo, resumo=excluded.resumo, corpo_md=excluded.corpo_md, tags=excluded.tags, ordem=excluded.ordem, publicado=true;

insert into public.conteudos (area, tema, titulo, resumo, corpo_md, tags, ordem, origem, id_externo, publicado)
values ($md$comercial$md$, $md$Manuais do sistema$md$, $md$Manual — Comercial (SDR)$md$, $md$Leads/CRM, fases, reunião, perdido com motivo, cadências, metas do mês.$md$, $md$Leia antes o **Manual do sistema — o básico** (Base de conhecimento → Geral).

Você vê: Meu painel, Tarefas, Agenda, Avisos, Meu perfil, **Comercial** (Leads/CRM, Metas do mês, Base de conhecimento) e o chat *Comercial*.

## Leads (CRM)

Todo lead dos anúncios entra sozinho em **Novo lead** com campanha, público e anúncio de origem (via ChatGuru). Fases: Novo lead → Em contato → Em qualificação → Reunião agendada → Proposta → Contrato → Pagamento pendente → Ganho/Perdido.

- O card do lead é o seu lugar de trabalho: telefone/WhatsApp, origem, observações, histórico, tarefas da cadência.
- Mova a fase arrastando o card.
- Marcou reunião? Preencha **Reunião** no card: vira compromisso na Agenda da closer e lembrete automático para o lead.
- Perdeu? Marque **Perdido** com o motivo — o motivo alimenta o relatório de Growth.
- **Cadências (C1–C5):** quando entrarem no ar, cada passo aparece como tarefa sua com o dia e a ação ("C1 D6 — prova social + 5 ligações"); quando o lead responde, a cadência pausa sozinha.

## Metas do mês

Seus números: leads, contatos, reuniões, conversão.

## Regra de ouro

Se não está no card, não aconteceu.$md$, array[$md$manual$md$,$md$sistema$md$,$md$comercial$md$,$md$crm$md$]::text[], 2, 'manual', 'manual:comercial', true)
on conflict (id_externo) where id_externo is not null do update
  set area=excluded.area, tema=excluded.tema, titulo=excluded.titulo, resumo=excluded.resumo, corpo_md=excluded.corpo_md, tags=excluded.tags, ordem=excluded.ordem, publicado=true;

insert into public.conteudos (area, tema, titulo, resumo, corpo_md, tags, ordem, origem, id_externo, publicado)
values ($md$marketing$md$, $md$Manuais do sistema$md$, $md$Manual — Marketing$md$, $md$Pautas de conteúdo e base de conhecimento do marketing.$md$, $md$Leia antes o **Manual do sistema — o básico** (Base de conhecimento → Geral).

Você vê: Meu painel, Tarefas, Agenda, Avisos, Meu perfil, **Marketing** (Pautas de conteúdo, Base de conhecimento) e o chat *Marketing*.

## Pautas de conteúdo

Calendário de posts: ideia → roteiro → produção → publicado. Cada pauta pode virar tarefa com prazo. Os números do Instagram e dos anúncios entram sozinhos no Growth (as sócias acompanham por lá).

## Base de conhecimento → Marketing

Identidade visual, tom de voz, banco de ideias, playbook de conteúdo.$md$, array[$md$manual$md$,$md$sistema$md$,$md$marketing$md$]::text[], 2, 'manual', 'manual:marketing', true)
on conflict (id_externo) where id_externo is not null do update
  set area=excluded.area, tema=excluded.tema, titulo=excluded.titulo, resumo=excluded.resumo, corpo_md=excluded.corpo_md, tags=excluded.tags, ordem=excluded.ordem, publicado=true;

insert into public.conteudos (area, tema, titulo, resumo, corpo_md, tags, ordem, origem, id_externo, publicado)
values ($md$financeiro$md$, $md$Manuais do sistema$md$, $md$Manual — Financeiro (Cobranças, Estoque e Inventário)$md$, $md$Cobranças/Asaas, estoque de consumo com reposição automática e inventário patrimonial com revisão periódica.$md$, $md$Leia antes o **Manual do sistema — o básico** (Base de conhecimento → Geral).

Você vê: Meu painel, Tarefas, Agenda, Avisos, Meu perfil, **Clientes**, **Financeiro** (Cobranças/Asaas, Estoque, Inventário, Base de conhecimento) e o chat *Financeiro*.

## Cobranças (Asaas)

Espelho do Asaas, sincronizado todo dia de manhã (e pelo botão **Sincronizar**). KPIs: recebido no mês, a vencer, em atraso, em aberto. Filtros por status, cliente, tipo (entrada, parcela, êxito, mensalidade).

- Abrir uma cobrança: fatura, boleto, copiar Pix, observações, pausar a régua.
- **Nova cobrança**: cliente, tipo, valor, parcelas, vencimento, forma. Cria no Asaas e aqui.
- **Vincular cliente**: cobrança que veio do Asaas sem cliente no sistema.
- A régua de cobrança por WhatsApp (3 dias antes, no dia, +1, +5, +10) está **desligada** até o lançamento; quando ligar, atraso de 10 dias abre tarefa para você.
- Pagamento confirmado atualiza a ficha do cliente ("honorários em dia") sozinho. Pagamento da **entrada** de cliente novo libera sozinho a R1 do onboarding.

## Ficha do cliente → Financeiro

Cobranças daquele cliente.

## Estoque (consumo)

Produtos de consumo do escritório — **Alimentícios** e **Escritório**.

- **+ Produto**: nome, categoria, unidade, saldo inicial, estoque mínimo e quantidade desejada após a reposição. O saldo atual não se edita na mão: ele só muda por movimentação.
- Na lista, os botões **−** e **+** registram retirada e entrada (quantidade + observação). O sistema não deixa retirar mais do que tem.
- Quando o saldo chega ao mínimo, abre sozinha a tarefa **"Reposição de estoque: <produto>"** para o administrativo, com a quantidade sugerida de compra. Não duplica enquanto houver uma aberta; quando a entrada repõe acima do mínimo, a tarefa é concluída sozinha.
- **Lista de compras**: tudo que precisa ser comprado, com a quantidade sugerida e a tarefa ligada. Filtre por categoria.
- **Movimentações**: histórico completo (quem, quando, quanto, por quê).
- Consumo médio semanal/mensal e "dias restantes" aparecem quando há histórico suficiente de retiradas; antes disso o sistema avisa "previsão ainda não confiável".

## Inventário (patrimônio)

Equipamentos do escritório, cada um com patrimônio (NP-001, NP-002…), tipo, marca/modelo, número de série, situação (em uso / disponível / manutenção / baixado), responsável e departamento.

- **+ Equipamento** cadastra; o patrimônio é sugerido automaticamente.
- **Atribuir / Devolver / Transferir** registra quem está com o quê; toda mudança fica no **Histórico** do item.
- **Por pessoa**: o que cada colaborador tem em mãos.
- **Revisão**: o sistema abre uma tarefa de revisão periódica (mensal ou trimestral, configurável em **Revisão → configurar**). Na revisão, marque cada item como **Localizado**, **Divergente** ou **Não localizado** (com a pendência). Pode abrir uma revisão fora do ciclo pelo botão **Abrir uma revisão agora**.

Estoque e inventário são separados: um é consumo, o outro é patrimônio.$md$, array[$md$manual$md$,$md$sistema$md$,$md$financeiro$md$,$md$estoque$md$,$md$inventario$md$]::text[], 2, 'manual', 'manual:financeiro', true)
on conflict (id_externo) where id_externo is not null do update
  set area=excluded.area, tema=excluded.tema, titulo=excluded.titulo, resumo=excluded.resumo, corpo_md=excluded.corpo_md, tags=excluded.tags, ordem=excluded.ordem, publicado=true;

insert into public.conteudos (area, tema, titulo, resumo, corpo_md, tags, ordem, origem, id_externo, publicado)
values ($md$administrativo$md$, $md$Manuais do sistema$md$, $md$Manual — Sócias e roteiro de treinamento$md$, $md$Visão de equipe, usuários e acessos, gestão, avisos, roteiro de treinamento de 40 min por área e pré-requisitos.$md$, $md$Acesso total. Além de todos os manuais:

- **Meu painel → Equipe**: tudo de todos; Carteira (saldo e contratos); Leads atrasados; atividade por setor.
- **Equipe → Usuários**: quem acessa o quê (áreas e "controle do jurídico"). **Colaboradores**: fichas, Discord, Google Agenda, ponto.
- **Gestão**: Visão geral, Growth (Meta Ads + Instagram + CRM), Financeiro.
- **Avisos → + Aviso** (todo o escritório ou por área; vai também para o Discord). Card **Discord**: configuração da ponte.
- **Financeiro → régua de cobrança** (ligar/desligar).
- Carteira e projeções no painel do cliente.

## Roteiro de treinamento (40 min por área)

1. (5 min) Entrar, trocar senha, foto. Mostrar sino e chat.
2. (10 min) Meu painel e Tarefas: criar uma tarefa real, abrir a tela dela, comentar com @, passar para alguém, lançar horas, concluir. Cada um faz na própria conta.
3. (10 min) A tela principal da área (Jurídico: ficha do cliente + Processos + Negociações; Comercial: Leads; Financeiro: Cobranças + Estoque; Marketing: Pautas).
4. (5 min) Agenda: mês/semana, criar um compromisso.
5. (5 min) Base de conhecimento da área: onde está o manual e os POPs.
6. (5 min) Combinados: toda demanda vira tarefa; registrar no sistema, não no WhatsApp; horas na hora; concluir ao terminar.

Estagiários: + 5 min de ponto. Controladoria: + 15 min na visão de equipe e nos relatórios.

## Pré-requisitos para o treinamento

- Logins criados para a equipe (+ Isadora).
- Responsável certo em cada processo e cliente.
- `data_fechamento` preenchido nos clientes.
- Avisos: publicar um "Bem-vindos ao sistema" com o link e o combinado.$md$, array[$md$manual$md$,$md$sistema$md$,$md$treinamento$md$]::text[], 5, 'manual', 'manual:socias', true)
on conflict (id_externo) where id_externo is not null do update
  set area=excluded.area, tema=excluded.tema, titulo=excluded.titulo, resumo=excluded.resumo, corpo_md=excluded.corpo_md, tags=excluded.tags, ordem=excluded.ordem, publicado=true;

select 'ok 0065 — '||count(*)||' manuais' as resultado from public.conteudos where id_externo like 'manual:%';
