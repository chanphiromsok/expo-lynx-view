export interface IGamePreview {
  id: string;
  name: string;
  cover: {
    image_id: string;
  };
}

export interface IGame extends IGamePreview {
  rating: number;
  release_dates: {
    human: string;
  }[];
  summary: string;
  genres: {
    id: string;
    name: string;
  }[];
  screenshots: {
    id: string;
    image_id: string;
  }[];
  platforms: {
    id: string;
    name: string;
  }[];
  involved_companies: {
    id: string;
    company: {
      id: string;
      name: string;
    };
  }[];
  similar_games: IGamePreview[];
}

export interface IGameEventPreview {
  id: string;
  name: string;
  event_logo: {
    image_id: string;
  };
  start_time: number;
}

export interface IGameEvent extends IGameEventPreview {
  description: string;
  games: IGamePreview[];
}
