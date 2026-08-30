import { useQuery } from "@tanstack/react-query";
import type { IGame } from "../types.ts";

const useGame = (id: string) => {
  const getGame = async (): Promise<IGame> => {
    const query = `
      fields name, cover.image_id, rating, genres.name, summary, platforms.name, release_dates.human,
      involved_companies.company.name,
      similar_games.name, similar_games.cover.image_id,
      screenshots.image_id;
      where id = ${id};
    `;

    const response = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Accept: "application/json",
      },
      body: query,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch games: ${response.statusText}`);
    }

    const data = await response.json();
    return data[0];
  };

  return useQuery({
    queryKey: ["game", id],
    queryFn: getGame,
    enabled: !!id,
  });
};

export default useGame;
