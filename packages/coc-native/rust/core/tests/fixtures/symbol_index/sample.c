struct point {
    int x;
    int y;
};

/// Build a point from two coordinates.
struct point make_point(int x, int y) {
    struct point result = {x, y};
    return result;
}
