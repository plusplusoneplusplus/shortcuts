namespace fixture {
template <typename T>
class Box {
public:
    T value() const { return value_; }

private:
    T value_;
};

Box<int> make_box() {
    return {};
}
}
