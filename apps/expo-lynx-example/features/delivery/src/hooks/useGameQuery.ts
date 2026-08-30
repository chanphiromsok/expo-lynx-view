import { useQuery } from "@tanstack/react-query";
import type { IGamePreview } from "../types.ts";

const useGameQuery = (query: string) => {
  const getQueriedGames = async (): Promise<IGamePreview[]> => {
    if (!query) {
      return [];
    }

    const response = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Accept: "application/json",
      },
      body: query,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch games: ${JSON.stringify(response)}`);
    }

    const data = await response.json();
    return data;
  };

  return useQuery({
    queryKey: ["gameQuery", query],
    queryFn: getQueriedGames,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: Infinity,
  });
};

export default useGameQuery;
