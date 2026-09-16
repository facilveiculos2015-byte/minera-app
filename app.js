// ATENÇÃO: Substitua com as suas chaves do painel do Supabase (Project Settings > API)
const SUPABASE_URL = 'https://eelbuaxgfzvxosatwcxk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlbGJ1YXhnZnp2eG9zYXR3Y3hrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NjI2MTAsImV4cCI6MjEwNDAzODYxMH0.ecoI2ClOQY9VKTcaMc1NoFTTvo0L-sadqfqHyDwxDTA';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function carregarLotes() {
    const listaDiv = document.getElementById('lotes-lista');
    
    try {
        const { data, error } = await supabaseClient
            .from('lotes')
            .select('*')
            .order('id', { ascending: false });

        if (error) throw error;

        if (data.length === 0) {
            listaDiv.innerHTML = '<p>Nenhum lote cadastrado.</p>';
            return;
        }

        let html = '<ul>';
        data.forEach(lote => {
            html += `<li><b>${lote.codigo_lote}</b> - ${lote.origem} (${lote.peso_bruto_kg} kg) [Status: ${lote.status}]</li>`;
        });
        html += '</ul>';
        listaDiv.innerHTML = html;

    } catch (err) {
        console.error('Erro ao carregar:', err.message);
        listaDiv.innerHTML = '<p style="color: #ef4444;">Erro ao carregar dados do servidor.</p>';
    }
}

document.getElementById('form-lote').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const codigo_lote = document.getElementById('codigo_lote').value;
    const origem = document.getElementById('origem').value;
    const peso_bruto_kg = parseFloat(document.getElementById('peso_bruto').value);

    const { error } = await supabaseClient
        .from('lotes')
        .insert([{ codigo_lote, origem, peso_bruto_kg, status: 'pendente' }]);

    if (error) {
        alert('Erro ao cadastrar lote: ' + error.message);
    } else {
        alert('Lote cadastrado com sucesso!');
        document.getElementById('form-lote').reset();
        carregarLotes();
    }
});

// Inicializar carregamento
carregarLotes();
