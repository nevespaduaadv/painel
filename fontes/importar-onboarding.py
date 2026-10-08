#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Importa os formulários de onboarding (HTML gerados pelo "Diagnóstico Empresarial") e os documentos da pasta
de cada cliente PJ para a ficha do sistema (migration 0008): clientes.*, bens, documentos.

Uso:  python3 fontes/importar-onboarding.py <pasta_clientes> <mapa.json> > supabase/dados/0009_onboarding.sql
  <pasta_clientes>: cópia local de GERAL/CLIENTES/- PESSOA JURÍDICA
  <mapa.json>: {"NOME DA PASTA": "cli-id", ...}
Nunca grava senhas: linhas com "senha"/"login" são descartadas. A saída contém dados de clientes — NÃO versionar.
"""
import os, re, sys, json, html as H, datetime

def html_text(p):
    x=open(p,encoding='utf8',errors='ignore').read()
    x=re.sub(r'<(script|style)[^>]*>.*?</\1>','',x,flags=re.S)
    x=re.sub(r'<br\s*/?>|</p>|</div>|</li>|</h\d>|</tr>','\n',x);x=re.sub(r'<[^>]+>','',x)
    return H.unescape(x)

PERG=[("veiculos",r"alienado a algum banco\.(.*)"),("imoveis",r"ou se é bem de família\.(.*)"),
      ("maquinario",r"outros ativos relevantes\?(.*)"),("quais_ativos",r"Se sim, quais\?(.*)"),("ativos_onus",r"dado em garantia\?(.*)"),
      ("contratos",r"1 consignado no CPF\.(.*)"),("situacao",r"se já virou processo judicial\.(.*)"),("garantia",r"Se sim, em qual contrato\?(.*)"),
      ("maquininha",r"maquininha de cartão\?(.*)"),("consorcio",r"possuem consórcio\?(.*)"),("outros_cnpjs",r"familiares ou de sócios\?(.*)"),("quais_cnpjs",r"qual a atividade de cada um\?(.*)"),
      ("assuntos",r"gostaria de discutir na reunião\?(.*)"),("acao",r"Existe ação judicial em seu nome ou no nome da empresa\?(.*)"),("negativado",r"\(Serasa, SPC, protesto\)\?(.*)"),
      ("disponibilidade",r"Melhores dias e horários para reuniões(.*)"),("extra",r"Qualquer detalhe sobre sua situação pode ser relevante\.(.*)")]

def blocos(t):
    """Divide o texto em blocos pergunta→resposta (resposta pode ter várias linhas até a próxima pergunta numerada/conhecida)."""
    t=re.sub(r'\n(?=\d{2}[A-ZÁ-Ú])','\n\x00',t)  # marca seções 01Início, 02Bens…
    linhas=[l.strip() for l in t.split('\n')]
    linhas=[l for l in linhas if l and not re.search(r'senha|login|LGPD|13\.709|Tratamento dos seus dados|Li e concordo|Declaro que|Documento gerado|Contém informações|8\.906|Circulação restrita',l,re.I)]
    return '\n'.join(linhas)

def responder(texto,rx):
    m=re.search(rx+r'\n?((?:(?!\n[A-ZÁ-Ú][^\n]*\?|\n\x00|\nSe sim|\nPara cada|\nInforme|\nEx;|\nUse este).)*)',texto,re.S|re.I)
    if not m:return None
    r=(m.group(1)+(m.group(2) if m.lastindex and m.lastindex>=2 else '')).strip() if m.lastindex else m.group(0)
    r=re.sub(r'\s+',' ',r).strip(' .')
    return r or None

def simnao(v):
    if not v:return None
    v=v.lower()
    if v.startswith('sim'):return True
    if v.startswith('n'):return False
    return None

def q(s):return "'"+str(s).replace("'","''")+"'"
def lit(v):return 'null' if v in (None,'') else (('true' if v else 'false') if isinstance(v,bool) else q(v))

def bens_de(cid,tipo,txt,titular_hint=None):
    out=[]
    if not txt or re.match(r'^(n[aã]o|nenhum|sim$)',txt.strip(),re.I):return out
    for parte in re.split(r'[;\n]|\s(?=\d\s?[-–])',txt):
        parte=parte.strip(' -–')
        if len(parte)<3:continue
        tit='PJ' if re.search(r'nome da empresa|\bPJ\b|CNPJ',parte,re.I) else ('PF' if re.search(r'pessoa f[ií]sica|\bPF\b|meu nome|no nome d[ao] ',parte,re.I) else titular_hint)
        onus=None
        for k,v in [(r'quitad|livre','Livre'),(r'financiad','Financiado'),(r'alienad','Alienado fiduciariamente'),(r'hipotec','Hipotecado'),(r'penhor','Penhorado'),(r'bem de fam','Bem de família'),(r'usufruto','Usufruto'),(r'vendid','Vendido sem transferência'),(r'consorci','Consórcio')]:
            if re.search(k,parte,re.I):onus=v;break
        out.append((cid,tipo,parte[:200],tit,onus))
    return out

TIPO_DOC=[(r'parecer','parecer'),(r'onboarding|resumo_onboarding|resumo_reuniao','onboarding'),(r'transcri','transcricao'),(r'extrato','extrato'),(r'cart[aã]o.?cnpj|cnpj novo|cnpj antigo|qsa','cartao_cnpj'),(r'contrato social|alteração contratual|alteracao contratual','contrato_social'),
          (r'honor','contrato_honorarios'),(r'procura','procuracao'),(r'acordo|minuta','acordo'),(r'contrato|ccb|c[eé]dula|pronampe|capital de giro|financiamento|emprést|emprest|renegocia','contrato_bancario'),(r'embargos|peti|inicial|defesa','peticao'),(r'senten|decis|despacho','decisao')]

def main():
    base,mapa=sys.argv[1],json.load(open(sys.argv[2]))
    hoje=datetime.date.today().isoformat()
    print(f"-- Importação dos formulários de onboarding e índice de documentos da pasta — gerado em {hoje}. NÃO versionar.")
    print("begin;")
    for pasta,cid in mapa.items():
        d=os.path.join(base,pasta)
        if not os.path.isdir(d):print(f"-- pasta não encontrada: {pasta}");continue
        # documentos (índice da pasta: caminho fica em observacoes; o link do Drive pode ser colado depois)
        for root,_,files in os.walk(d):
            for f in sorted(files):
                if re.search(r'\.(mp4|mp3|p7z|png|jpe?g|gdoc)$',f,re.I) or not re.search(r'\.(pdf|docx?|xlsx|html)$',f,re.I):continue
                rel=os.path.relpath(os.path.join(root,f),d).replace('\\','/')
                tipo='outro'
                for rx,t in TIPO_DOC:
                    if re.search(rx,f,re.I):tipo=t;break
                print(f"insert into public.documentos (cliente_id, titulo, tipo, observacoes, visivel_cliente) select {q(cid)}, {q(f[:160])}, {q(tipo)}, {q('Pasta do cliente: '+rel)}, false where not exists (select 1 from public.documentos where cliente_id={q(cid)} and observacoes={q('Pasta do cliente: '+rel)});")
        # onboarding html
        htmls=[os.path.join(r,f) for r,_,fs in os.walk(d) for f in fs if f.lower().endswith('.html') and 'onboarding' in f.lower()]
        for p in sorted(htmls)[-1:]:
            t=blocos(html_text(p))
            data=re.search(r'Respostas recebidas em (\d{2})/(\d{2})/(\d{4})',t);donb=f"{data.group(3)}-{data.group(2)}-{data.group(1)}" if data else None
            def resp(rx):
                m=re.search(rx,t,re.I)
                if not m:return None
                v=re.sub(r'\s+',' ',m.group(1)).strip(' .')
                return v or None
            R={k:resp(rx) for k,rx in PERG}
            obs=[]
            for k,l in [("contratos","Contratos e bancos informados"),("situacao","Situação dos contratos"),("garantia","Garantias"),("acao","Ação judicial"),("quais_cnpjs","Outros CNPJs"),("extra","Observações do cliente")]:
                if R.get(k):obs.append(f"{l}: {R[k]}")
            sets={"data_onboarding":donb,"negativado":simnao(R.get('negativado')),"usa_maquininha":simnao(R.get('maquininha')),"tem_consorcio":simnao(R.get('consorcio')),
                  "outros_cnpjs":(R.get('quais_cnpjs') if simnao(R.get('outros_cnpjs')) else None),"assuntos_interesse":R.get('assuntos'),"disponibilidade":R.get('disponibilidade'),
                  "observacoes_onboarding":'\n'.join(obs) or None,"situacao_atual":R.get('situacao')}
            cols=', '.join(f"{k} = coalesce({k}, {lit(v)})" for k,v in sets.items() if v not in (None,''))
            if cols:print(f"update public.clientes set {cols} where id = {q(cid)};")
            for (c,tipo,desc,tit,onus) in bens_de(cid,'veiculo',R.get('veiculos'))+bens_de(cid,'imovel',R.get('imoveis'))+bens_de(cid,'maquinario',R.get('ativos_onus') if simnao(R.get('maquinario')) else None):
                print(f"insert into public.bens (cliente_id, tipo, descricao, titular, onus) select {q(c)}, {q(tipo)}, {q(desc)}, {lit(tit)}, {lit(onus)} where not exists (select 1 from public.bens where cliente_id={q(c)} and descricao={q(desc)});")
    print("commit;")
if __name__=='__main__':main()
