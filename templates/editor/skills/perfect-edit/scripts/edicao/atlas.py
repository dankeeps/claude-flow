"""Onde está o Atlas (Octo Edição) nesta máquina. Ordem: $PERFECT_EDIT_ATLAS, ~/Octo Edição/Atlas, ~/Editor Atlas.
Os projetos ficam em $ESTUDIO_RAIZ ou ~/Edições (o mesmo padrão do Atlas)."""
import os, sys
_c = [os.environ.get("PERFECT_EDIT_ATLAS"), "~/Octo Edição/Atlas", "~/Editor Atlas"]
ATLAS = next((os.path.expanduser(p) for p in _c if p and os.path.isdir(os.path.join(os.path.expanduser(p), "lib"))), None)
if not ATLAS: sys.exit("Atlas não encontrado: rode o install.sh da Perfect Edit (ou defina PERFECT_EDIT_ATLAS)")
LIB = os.path.join(ATLAS, "lib"); sys.path.insert(0, LIB)
EDICOES = os.path.expanduser(os.environ.get("ESTUDIO_RAIZ") or "~/Edições")
