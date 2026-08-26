# voktty-shell-integration (zshenv)
#
# Trailing `:` is load-bearing — without it, a missing user .zshenv leaves $?=1,
# which propagates through the rest of init and ultimately into the first
# prompt's `%?` (rendering robbyrussell's `➜` red on a clean shell start).
{
  _voktty_user_zdotdir="${VOKTTY_USER_ZDOTDIR:-$HOME}"
  [ -f "$_voktty_user_zdotdir/.zshenv" ] && source "$_voktty_user_zdotdir/.zshenv"
  unset _voktty_user_zdotdir
}
:
