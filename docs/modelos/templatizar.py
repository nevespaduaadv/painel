"""Transforma os modelos do escritório em templates docxtemplater ({campo}, {#secao}...{/secao}).
Mantém a formatação do parágrafo (pPr) e dos runs (rPr do 1º run em negrito / 1º run normal)."""
import re, sys, zipfile, shutil, html

def esc(t):
    return html.escape(t, quote=False)

def load(path):
    z = zipfile.ZipFile(path)
    return z, z.read('word/document.xml').decode()

def paras(x):
    return [(m.start(), m.end(), m.group(0)) for m in re.finditer(r'<w:p[ >].*?</w:p>', x, flags=re.S)]

def rprs(p):
    """rPr do primeiro run em negrito e do primeiro normal (sem texto vazio)."""
    b = n = None
    for r in re.findall(r'<w:r[ >].*?</w:r>', p, flags=re.S):
        if not re.search(r'<w:t[^>]*>[^<]+</w:t>', r):
            continue
        m = re.search(r'<w:rPr>.*?</w:rPr>', r, flags=re.S)
        rpr = m.group(0) if m else '<w:rPr/>'
        bold = bool(re.search(r'<w:b(?: [^>]*)?/>', rpr)) and 'w:val="0"' not in rpr
        if bold and b is None: b = rpr
        if not bold and n is None: n = rpr
    if b is None and n is not None: b = n.replace('<w:rPr>', '<w:rPr><w:b/>', 1) if '<w:rPr>' in n else '<w:rPr><w:b/></w:rPr>'
    if n is None and b is not None: n = re.sub(r'<w:b(?: [^>]*)?/>', '', b)
    return b or '<w:rPr><w:b/></w:rPr>', n or '<w:rPr/>'

def rebuild(p, spec):
    """spec: lista de (negrito:bool, texto). '\n' no texto vira quebra de linha."""
    b, n = rprs(p)
    ppr = re.search(r'<w:pPr>.*?</w:pPr>', p, flags=re.S)
    ppr = ppr.group(0) if ppr else ''
    runs = []
    for bold, text in spec:
        parts = text.split('\n')
        for i, part in enumerate(parts):
            if i: runs.append('<w:r>%s<w:br/></w:r>' % (b if bold else n))
            if part:
                runs.append('<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>' % (b if bold else n, esc(part)))
    head = re.match(r'<w:p[^>]*>', p).group(0)
    return head + ppr + ''.join(runs) + '</w:p>'

def apply(path_in, path_out, edits, inserts=()):
    """edits: {indice_paragrafo: spec}; inserts: [(indice_base, spec)] = clona o parágrafo base logo depois dele."""
    z, x = load(path_in)
    ps = paras(x)
    new = []
    last = 0
    for k, (s, e, p) in enumerate(ps):
        new.append(x[last:s])
        for base, spec, *pos in inserts:
            if base == k and pos and pos[0] == 'before': new.append(rebuild(p, spec))
        new.append(rebuild(p, edits[k]) if k in edits else p)
        for base, spec, *pos in inserts:
            if base == k and (not pos or pos[0] == 'after'): new.append(rebuild(p, spec))
        last = e
    new.append(x[last:])
    out = ''.join(new)
    zout = zipfile.ZipFile(path_out, 'w', zipfile.ZIP_DEFLATED)
    for item in z.infolist():
        data = out.encode() if item.filename == 'word/document.xml' else z.read(item.filename)
        zout.writestr(item, data)
    zout.close()

B, N = True, False

# ---------- Contrato GP ----------
contrato = {
    5: [(B, '{empresa}'),
        (N, '{#pj}, pessoa jurídica de direito privado, devidamente inscrita no CNPJ/ME sob o n° {cnpj}, com sede na {endereco}, CEP {cep}, na cidade de {cidade}/{uf}, neste ato representada por seu(sua) {cargo} {/pj}'),
        (B, '{#pj}{representante}{/pj}'),
        (N, '{#pj}, {qualificacao}, portador(a) do CPF n° {cpf} e RG n° {rg}{/pj}{#pf}, {qualificacao}, portador(a) do CPF n° {cpf} e RG n° {rg}, residente e domiciliado(a) na {endereco}, CEP {cep}, na cidade de {cidade}/{uf}{/pf}, doravante denominado(a) simplesmente '),
        (B, 'Contratante;')],
    15: [(N, '{valor_ext} – Referente a dívidas junto ao {banco}{#descricao} ({descricao}){/descricao};')],
    36: [(B, 'Cláusula 2ª – '), (N, 'Pelos serviços prestados pelo Contratado, pagará o(a) Contratante o valor de '),
         (B, '{total_ext}'), (N, '{#exito} e {/exito}'), (B, '{#exito}{exito_ext}{/exito}'),
         (N, '{#exito} a título de êxito{/exito}, a ser pago da seguinte forma:')],
    38: [(B, '{entrada_ext}'), (N, ' a título de entrada, com vencimento em até '), (B, '{prazo_entrada}'),
         (N, ' a partir da assinatura do presente contrato{#parcelado}; e o remanescente de {/parcelado}'),
         (B, '{#parcelado}{remanescente_ext}{/parcelado}'), (N, '{#parcelado} em {/parcelado}'),
         (B, '{#parcelado}{parcelas_ext}{/parcelado}'), (N, '{#parcelado} parcelas iguais e sucessivas no valor de {/parcelado}'),
         (B, '{#parcelado}{parcela_ext}{/parcelado}'), (N, '{#parcelado} cada, com vencimento todo dia {/parcelado}'),
         (B, '{#parcelado}{dia_ext}{/parcelado}'), (N, '{#parcelado} de cada mês, a partir do mês subsequente à assinatura do presente contrato{/parcelado};')],
    40: [(N, '{exito_ext} ad êxito após a realização dos acordos;')],
    111: [(B, '{empresa} – Contratante')],
    116: [(B, '{#pj}Por seu(sua) {cargo} {representante}{/pj}{#pf}{representante}{/pf}')],
}
contrato_inserts = [
    (15, [(N, '{#dividas}')], 'before'), (15, [(N, '{/dividas}')], 'after'),
    (40, [(N, '{#exito}')], 'before'),
    (40, [(N, '{/exito}')], 'after'),
    (40, [(N, '{#mensalidade}')], 'after'),
    (40, [(N, '{mensalidade_ext} mensais, a título de acompanhamento contínuo, com vencimento todo dia {dia_ext} de cada mês, a partir do mês subsequente à assinatura do presente contrato;')], 'after'),
    (40, [(N, '{/mensalidade}')], 'after'),
]

# ---------- Procurações (PJ outorgante + PF representante) ----------
proc = {
    2: [(B, 'Outorgante: '), (B, '{empresa}'),
        (N, ', pessoa jurídica de direito privado, inscrita no CNPJ/MF sob o nº {cnpj}, situada na {endereco}, CEP: {cep}, {cidade}/{uf}, neste ato representada por '),
        (B, '{representante}, '),
        (N, '{qualificacao}, inscrito(a) no CPF sob o nº {cpf}, portador(a) da cédula de identidade RG nº {rg}, residente e domiciliado(a) à {rep_endereco}, CEP: {rep_cep}, {rep_cidade}/{rep_uf}{#rep_email}, {rep_email}{/rep_email}.')],
    6: [(N, 'Franca/SP, {data_ext}.')],
    8: [(B, '{empresa}'), (N, '\nPor seu(sua) {cargo} {representante}')],
    11: [(B, 'Outorgante: '), (B, '{representante}, '),
         (N, '{qualificacao}, inscrito(a) no CPF sob o nº {cpf}, portador(a) da cédula de identidade RG nº {rg}, residente e domiciliado(a) à {rep_endereco}, CEP: {rep_cep}, {rep_cidade}/{rep_uf}{#rep_email}, {rep_email}{/rep_email}.')],
    16: [(N, 'Franca/SP, {data_ext}.')],
    20: [(B, '{representante}')],
}

if __name__ == '__main__':
    apply('contrato_gp.docx', 'tpl_contrato_gp.docx', contrato, contrato_inserts)
    apply('proc_dh_pj.docx', 'tpl_procuracoes_pj.docx', proc)
    print('ok')
