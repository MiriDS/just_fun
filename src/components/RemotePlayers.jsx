import { Avatar } from "./Avatar";
import { ChatBubble } from "./ChatBubble";

/**
 * Everyone else in the scene, one Avatar each.
 *
 * They are deliberately not part of the physics world: only the local player
 * gets a body in Scatter, so the debris a visitor knocks about is theirs
 * alone. Two browsers running the same rigid bodies diverge the moment one of
 * them touches something, and keeping them honest would mean simulating every
 * box on the server — the one thing in this design that would actually cost
 * bandwidth. See PROJECT.md §5.
 */
export function RemotePlayers({ players, motions, messages, muted }) {
  return (
    <>
      {players.map((player) => {
        const motion = motions.get(player.id);
        // A join that has re-rendered before its motion was recorded, which
        // the handlers make impossible — but a missing one would be a crash
        // in the render path, so it is cheap to be sure.
        if (!motion) return null;

        const message = messages[player.id];

        return (
          <Avatar
            key={player.id}
            // `appearance` is already on the player record, assigned by the
            // server. v1 renders one look for everyone; wiring it up is what
            // step 5 of the plan is for.
            position-y={-0.5}
            motion={motion}
          >
            {!muted && message && (
              <ChatBubble key={message.at} text={message.text} />
            )}
          </Avatar>
        );
      })}
    </>
  );
}
