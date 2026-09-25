/* Minera Pará — ações compartilhadas dos anúncios do usuário (lotes.js + perfil.js).
 * Depende de auth-guard.js (supabaseClient, exigirDesbloqueado, registrarLog, toastMsg,
 * isComissao1pctAtiva, aplicarDescontoPontosComissao opcional).
 */
(function () {
    'use strict';

    var MSG_CONFIRMA_EXCLUIR = 'Excluir este anúncio? Essa ação não pode ser desfeita.';

    function toast(t) {
        if (typeof toastMsg === 'function') toastMsg(t);
        else alert(t);
    }

    /** Mesmo critério de "meu lote" usado em lotes.js (auth id; fallback pelo nome). */
    function ehMeuLote(l, session, perfil) {
        if (!l) return false;
        var uid = session && session.user ? session.user.id : null;
        var nome = (perfil && perfil.nome) || '';
        if (uid && l.criado_por_id && l.criado_por_id === uid) return true;
        if (uid && l.criado_por_id == null && nome && l.criado_por === nome) return true;
        if (!l.criado_por_id && nome && l.criado_por === nome) return true;
        return false;
    }

    /** Carrega todos os lotes visíveis e devolve só os do usuário (mesma query de lotes.js). */
    async function carregarMeus(session, perfil) {
        var res = await supabaseClient.from('lotes').select('*').order('id', { ascending: false });
        if (res.error) throw res.error;
        var todos = res.data || [];
        return { todos: todos, meus: todos.filter(function (l) { return ehMeuLote(l, session, perfil); }) };
    }

    async function criarComissaoVenda(lote, session, perfil) {
        if (typeof isComissao1pctAtiva === 'function' && !(await isComissao1pctAtiva())) {
            return { skipped: true, paused: true };
        }
        var preco = lote && lote.preco != null ? Number(lote.preco) : 0;
        if (!(preco > 0) || !lote || !lote.id) return null;
        // Idempotente: skip se já existe comissão para este lote
        try {
            var sel = await supabaseClient.from('comissoes').select('id').eq('lote_id', lote.id).limit(1);
            if (sel.error) {
                console.warn('comissoes select:', sel.error.message);
                if (/relation|comissoes|schema cache|does not exist/i.test(sel.error.message || '')) {
                    toast('Aplique o SQL 12-comissoes.sql no Supabase');
                }
                return null;
            }
            if (sel.data && sel.data.length) return sel.data[0];
        } catch (e) {
            console.warn(e);
            return null;
        }
        var percentual = 1;
        var bruta = Math.round(preco * percentual) / 100;
        var uid = (session && session.user && session.user.id) || (perfil && perfil.auth_id) || null;
        var nome = (perfil && perfil.nome) || lote.criado_por || 'Vendedor';
        var valor = bruta, desconto = 0, original = bruta;
        if (typeof aplicarDescontoPontosComissao === 'function' && uid) {
            var disc = await aplicarDescontoPontosComissao(uid, bruta);
            valor = disc.valor_comissao;
            desconto = disc.desconto_pontos || 0;
            original = disc.valor_comissao_original != null ? disc.valor_comissao_original : bruta;
        }
        var venc = new Date();
        venc.setDate(venc.getDate() + 7);
        var row = {
            lote_id: lote.id,
            vendedor_auth_id: uid,
            vendedor_nome: nome,
            valor_venda: preco,
            valor_comissao: valor,
            valor_comissao_original: original,
            desconto_pontos: desconto,
            percentual: percentual,
            status: 'pendente',
            vencimento: venc.toISOString()
        };
        var ins = await supabaseClient.from('comissoes').insert([row]).select('id').limit(1);
        if (ins.error) {
            if (/duplicate|unique|comissoes_lote/i.test(ins.error.message || '')) return { id: null };
            console.warn('comissao insert:', ins.error.message);
            if (/relation|comissoes|schema cache|does not exist/i.test(ins.error.message || '')) {
                toast('Aplique o SQL 12-comissoes.sql no Supabase');
            } else {
                toast('Comissão não gerada: ' + ins.error.message);
            }
            return null;
        }
        return ins.data && ins.data[0] ? ins.data[0] : { id: true };
    }

    /** Marca como vendido (status expedido). Retorna true se deu certo. */
    async function marcarVendido(id, lote, session, perfil) {
        if (typeof exigirDesbloqueado === 'function' && !exigirDesbloqueado(perfil, 'Marcar vendido')) return false;
        var r = await supabaseClient.from('lotes').update({ status: 'expedido' }).eq('id', id);
        if (r.error) {
            toast('Erro: ' + r.error.message);
            return false;
        }
        if (typeof registrarLog === 'function') await registrarLog('lote_vendido', { id: id }, perfil);
        var preco = lote && lote.preco != null ? Number(lote.preco) : 0;
        if (preco > 0) {
            var criada = await criarComissaoVenda(lote, session, perfil);
            if (criada && (criada.paused || criada.skipped)) {
                toast('Marcado como Vendido');
            } else if (criada) {
                var valorFmt = preco.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                toast('Comissão 1% (sobre R$ ' + valorFmt + ') gerada — pontos aplicados se houver; pague no Perfil/Pix');
            } else {
                toast('Marcado como Vendido');
            }
        } else {
            toast('Marcado como Vendido');
        }
        return true;
    }

    /** Pede confirmação e exclui. Retorna true se excluiu. */
    async function excluir(id, perfil) {
        if (!confirm(MSG_CONFIRMA_EXCLUIR)) return false;
        var r = await supabaseClient.from('lotes').delete().eq('id', id);
        if (r.error) {
            toast('Erro ao excluir: ' + r.error.message);
            return false;
        }
        if (typeof registrarLog === 'function') await registrarLog('lote_excluir', { id: id }, perfil);
        toast('Anúncio excluído');
        return true;
    }

    window.AnunciosAcoes = {
        MSG_CONFIRMA_EXCLUIR: MSG_CONFIRMA_EXCLUIR,
        ehMeuLote: ehMeuLote,
        carregarMeus: carregarMeus,
        criarComissaoVenda: criarComissaoVenda,
        marcarVendido: marcarVendido,
        excluir: excluir
    };
})();
