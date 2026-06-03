package com.family.drive.repository;

import com.family.drive.model.Album;
import com.family.drive.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface AlbumRepository extends JpaRepository<Album, Long> {
    List<Album> findByUserOrderByCreationTimeDesc(User user);
    Optional<Album> findByIdAndUser(Long id, User user);
}
