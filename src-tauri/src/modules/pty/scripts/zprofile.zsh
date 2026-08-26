# voktty-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:`.
{
  _voktty_user_zdotdir="${VOKTTY_USER_ZDOTDIR:-$HOME}"
  [ -f "$_voktty_user_zdotdir/.zprofile" ] && source "$_voktty_user_zdotdir/.zprofile"
  unset _voktty_user_zdotdir
}
:
